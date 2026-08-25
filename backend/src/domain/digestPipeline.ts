import { z } from 'zod';
import type { Email } from './email.js';
import { estimateTokens } from './emailText.js';
import { categorizeByHeuristics } from './senderHeuristics.js';
import {
  buildDigestPrompt,
  buildRetryPrompt,
  PROMPT_VERSION,
  renderEmailBlock,
  type DigestPrompt,
} from './summarizationPrompt.js';
import {
  EMAIL_CATEGORIES,
  type CacheableEmailSummary,
  type EmailSummary,
} from './summary.js';
import type { Logger } from '../logging/logger.js';

/**
 * The digest summarization pipeline (TICKET-104): cache lookup → token-budgeted batch
 * plan → one LLM call → schema validation with one retry → heuristic fallback → cache
 * write. Core decisions (planning, parsing, budgeting) are pure functions below; the
 * service at the bottom orchestrates them over injected ports, so the whole pipeline
 * runs in tests with no network and no clock.
 */

/**
 * Token caps sized to the ≤ $0.05/digest budget at 50 emails/day; the arithmetic lives
 * in docs/digest-cost.md and must be redone if any of these change.
 */
export const MAX_INPUT_TOKENS_PER_DIGEST = 12_000;
/** Room reserved for the instructions around the email blocks. */
export const PROMPT_OVERHEAD_TOKENS = 700;
/** Per-email body slice — also the `maxTokensPerBody` passed to the body fetcher. Sized
 * so 50 emails with heavy headers still fit the input cap (the golden test proves it). */
export const BODY_TOKENS_PER_EMAIL = 170;
/** Output budget: JSON envelope per email plus 1–2 short Amharic sentences (Ge'ez script
 * tokenizes at roughly one token per character). */
export const OUTPUT_TOKENS_PER_EMAIL = 120;
export const OUTPUT_OVERHEAD_TOKENS = 200;
/** Hard ceiling on the API `max_tokens`, independent of how many emails the input cap
 * admits — this is the output figure the budget math in docs/digest-cost.md relies on,
 * so it is enforced here rather than implied by the other constants. */
export const MAX_OUTPUT_TOKENS_PER_DIGEST = 6_200;
/** No email block can cost less than this envelope: tag lines, field labels, newlines. */
const MIN_EMAIL_ENVELOPE_TOKENS = 20;

/** Summaries are rendered to the user verbatim; Unicode directional and format controls
 * could visually reorder what she reads, so they never survive the model boundary. */
const FORMAT_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

function stripFormatControls(text: string): string {
  return text.replace(FORMAT_CONTROLS, '').trim();
}

/** What one digest batch call must answer with; validated at the model boundary. */
const LlmBatchResponse = z.object({
  summaries: z.array(
    z.object({
      messageId: z.string().min(1),
      category: z.enum(EMAIL_CATEGORIES),
      summary: z.string().transform(stripFormatControls).pipe(z.string().min(1).max(600)),
      urgent: z.boolean(),
    }),
  ),
});

type LlmItem = z.infer<typeof LlmBatchResponse>['summaries'][number];

export interface DigestBatchPlan {
  /** Emails that fit the input-token cap and get real Amharic summaries. */
  readonly llm: readonly Email[];
  /** Overflow: category-only treatment via sender heuristics, zero API cost. */
  readonly heuristicOnly: readonly Email[];
}

/**
 * Splits a digest's emails into "summarize" and "category-only" under the input-token
 * cap. Each email is costed as its rendered prompt block with a full body slice — a
 * ceiling, since real bodies are truncated to that same budget — so the plan can be made
 * before any body is fetched, and bodies are then fetched only for emails that will
 * actually be summarized. Input order (newest first) is kept: when the cap bites, it is
 * the oldest mail that falls back to heuristics.
 */
export function planDigestBatch(
  emails: readonly Email[],
  maxInputTokens: number = MAX_INPUT_TOKENS_PER_DIGEST,
): DigestBatchPlan {
  const llm: Email[] = [];
  const heuristicOnly: Email[] = [];
  let used = PROMPT_OVERHEAD_TOKENS;
  for (const [index, email] of emails.entries()) {
    // Once even the cheapest possible email cannot fit, the rest is provably overflow —
    // no need to render and measure hundreds of blocks that can never be admitted.
    if (used + MIN_EMAIL_ENVELOPE_TOKENS + BODY_TOKENS_PER_EMAIL > maxInputTokens) {
      heuristicOnly.push(...emails.slice(index));
      break;
    }
    const withEmptyBody: Email = { ...email, bodyText: null, snippet: '' };
    // The nonce is not known at planning time; a fixed-width stand-in costs the same.
    const cost =
      estimateTokens(renderEmailBlock(withEmptyBody, 0, 'nnnnnnnn')) + BODY_TOKENS_PER_EMAIL;
    if (used + cost <= maxInputTokens) {
      llm.push(email);
      used += cost;
    } else {
      heuristicOnly.push(email);
    }
  }
  return { llm, heuristicOnly };
}

export interface ParseOptions {
  /** When false (the first attempt), a reply that fails to cover every requested id is
   * invalid and worth the one retry. When true (the retry), partial coverage is kept —
   * the covered emails get their summaries, the rest fall back to heuristics — because
   * a third attempt is not allowed and discarding good entries buys nothing. */
  readonly allowPartialCoverage: boolean;
}

/**
 * Parses and schema-validates one model reply. `invalid` (never a throw) signals the
 * caller to spend its one retry. Lenient only about packaging — text around the JSON
 * object is ignored, and entries for ids that were never requested are dropped (they
 * cannot reach a client either way) — never about integrity: bad categories, missing
 * fields, incomplete coverage (per `allowPartialCoverage`) and above all a duplicated
 * message id fail validation. A duplicate is the fingerprint of an email instructing
 * the model to emit a second entry for a *sibling* message; first-entry-wins would let
 * the forged entry shadow the genuine one, so the whole reply is distrusted instead.
 */
export function parseLlmBatchResponse(
  reply: string,
  requestedIds: ReadonlySet<string>,
  options: ParseOptions,
): { kind: 'parsed'; items: ReadonlyMap<string, LlmItem> } | { kind: 'invalid' } {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { kind: 'invalid' };
  }
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1)) as unknown;
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = LlmBatchResponse.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid' };
  }
  const items = new Map<string, LlmItem>();
  for (const item of parsed.data.summaries) {
    if (!requestedIds.has(item.messageId)) {
      continue;
    }
    if (items.has(item.messageId)) {
      return { kind: 'invalid' };
    }
    items.set(item.messageId, item);
  }
  if (!options.allowPartialCoverage && items.size !== requestedIds.size) {
    return { kind: 'invalid' };
  }
  return { kind: 'parsed', items };
}

/** Category-only result for emails the LLM never sees (or failed to cover). */
export function heuristicSummary(email: Email): EmailSummary {
  return {
    messageId: email.id,
    category: categorizeByHeuristics(email),
    summary: null,
    urgent: false,
    source: 'heuristic',
    promptVersion: null,
  };
}

/** The one thing the pipeline needs from the Claude adapter: prompt in, raw text out. */
export interface SummarizerPort {
  complete(request: {
    readonly system: string;
    readonly user: string;
    readonly maxOutputTokens: number;
  }): Promise<string>;
}

/** Firestore-backed summary cache, keyed by message id — the same email is never
 * summarized twice. Only real LLM output is cached; heuristic results are free to
 * recompute and caching them would freeze an email out of ever being summarized. */
export interface SummaryCacheStore {
  getMany(uid: string, messageIds: readonly string[]): Promise<ReadonlyMap<string, EmailSummary>>;
  setMany(uid: string, summaries: readonly CacheableEmailSummary[]): Promise<void>;
}

/** Fetches truncated plain-text bodies for the given ids — structurally satisfied by
 * `GmailSyncService.fetchBodies`, so no new adapter is needed. */
export type BodyFetcher = (
  messageIds: readonly string[],
  maxTokensPerBody: number,
) => Promise<ReadonlyMap<string, string>>;

export interface DigestSummarizationResult {
  /** One summary per input email, in input order. */
  readonly summaries: readonly EmailSummary[];
  readonly promptVersion: string;
  readonly counts: {
    readonly fromCache: number;
    readonly fromLlm: number;
    readonly heuristicOnly: number;
  };
}

export interface DigestSummarizer {
  summarize(uid: string, emails: readonly Email[]): Promise<DigestSummarizationResult>;
}

export interface DigestSummarizerDependencies {
  readonly summarizer: SummarizerPort;
  readonly cache: SummaryCacheStore;
  readonly fetchBodies: BodyFetcher;
  /** Injected clock — only the date reaches the prompt, for urgency judgments. */
  readonly today: () => string;
  /** Per-request marker for the prompt's email-block tags; injected so tests are
   * deterministic. Unpredictability, not cryptographic strength, is what it provides —
   * a sender who cannot guess it cannot fabricate a block boundary. */
  readonly nonce?: () => string;
  /** Counts, ids and versions only — never email content or summaries. */
  readonly logger?: Logger;
  readonly maxInputTokens?: number;
}

function defaultNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createDigestSummarizer(deps: DigestSummarizerDependencies): DigestSummarizer {
  const maxInputTokens = deps.maxInputTokens ?? MAX_INPUT_TOKENS_PER_DIGEST;
  const nonce = deps.nonce ?? defaultNonce;

  /**
   * One batch call with the mandated failure ladder: schema-validate, one retry that
   * echoes the invalid reply, then heuristics. An API error (throw) takes the same
   * fallback — a digest built from heuristic categories still reaches the user, and the
   * uncached emails are retried by the next digest run.
   */
  async function summarizeBatch(
    emails: readonly Email[],
  ): Promise<ReadonlyMap<string, LlmItem>> {
    const requestedIds = new Set(emails.map((email) => email.id));
    const maxOutputTokens = Math.min(
      MAX_OUTPUT_TOKENS_PER_DIGEST,
      OUTPUT_OVERHEAD_TOKENS + OUTPUT_TOKENS_PER_EMAIL * emails.length,
    );
    const prompt = buildDigestPrompt(emails, deps.today(), BODY_TOKENS_PER_EMAIL, nonce());

    const attempt = async (request: DigestPrompt): Promise<string> =>
      deps.summarizer.complete({ ...request, maxOutputTokens });

    try {
      const reply = await attempt(prompt);
      // The first reply must cover every email — an incomplete one is invalid and worth
      // the retry. The retry's answer is final, so its partial coverage is kept: covered
      // emails get their summaries, the rest degrade to heuristics (warned below).
      const parsed = parseLlmBatchResponse(reply, requestedIds, { allowPartialCoverage: false });
      if (parsed.kind === 'parsed') {
        return parsed.items;
      }
      deps.logger?.warn('digest batch reply failed validation; retrying once', {
        emailCount: emails.length,
        promptVersion: PROMPT_VERSION,
      });
      const retried = parseLlmBatchResponse(await attempt(buildRetryPrompt(prompt, reply)), requestedIds, {
        allowPartialCoverage: true,
      });
      if (retried.kind === 'parsed') {
        if (retried.items.size < requestedIds.size) {
          deps.logger?.warn('digest batch retry left emails uncovered', {
            emailCount: emails.length,
            coveredCount: retried.items.size,
            promptVersion: PROMPT_VERSION,
          });
        }
        return retried.items;
      }
      deps.logger?.error('digest batch reply invalid after retry; falling back to heuristics', {
        emailCount: emails.length,
        promptVersion: PROMPT_VERSION,
      });
    } catch (error) {
      // Only the error's class name is logged: an SDK message is an uncontrolled string
      // on a request whose body is private mail, and no content may reach a log line.
      deps.logger?.error('digest batch call failed; falling back to heuristics', {
        emailCount: emails.length,
        promptVersion: PROMPT_VERSION,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    return new Map();
  }

  return {
    async summarize(uid, emails) {
      const cached = await deps.cache.getMany(uid, emails.map((email) => email.id));
      const uncached = emails.filter((email) => !cached.has(email.id));
      const plan = planDigestBatch(uncached, maxInputTokens);

      let llmItems: ReadonlyMap<string, LlmItem> = new Map();
      if (plan.llm.length > 0) {
        const bodies = await deps.fetchBodies(
          plan.llm.map((email) => email.id),
          BODY_TOKENS_PER_EMAIL,
        );
        const withBodies = plan.llm.map((email) => {
          const bodyText = bodies.get(email.id);
          return bodyText === undefined || bodyText === '' ? email : { ...email, bodyText };
        });
        llmItems = await summarizeBatch(withBodies);
      }

      const fresh: CacheableEmailSummary[] = [];
      const summaries = emails.map((email): EmailSummary => {
        const hit = cached.get(email.id);
        if (hit !== undefined) {
          return hit;
        }
        const item = llmItems.get(email.id);
        if (item === undefined) {
          // Planned for the LLM but absent from a valid reply, or heuristic-only by plan.
          return heuristicSummary(email);
        }
        const summary: CacheableEmailSummary = {
          messageId: email.id,
          category: item.category,
          summary: item.summary,
          urgent: item.urgent,
          source: 'llm',
          promptVersion: PROMPT_VERSION,
        };
        fresh.push(summary);
        return summary;
      });

      if (fresh.length > 0) {
        try {
          await deps.cache.setMany(uid, fresh);
        } catch (error) {
          // The cache is a cost optimization, not a correctness requirement: the paid
          // LLM work is already in hand, and dropping it over a failed write would turn
          // a Firestore blip into a fully heuristic digest. Worst case, the next run
          // re-summarizes these emails.
          deps.logger?.warn('summary cache write failed; digest continues uncached', {
            count: fresh.length,
            errorName: error instanceof Error ? error.name : typeof error,
          });
        }
      }

      const counts = {
        fromCache: cached.size,
        fromLlm: fresh.length,
        heuristicOnly: summaries.length - cached.size - fresh.length,
      };
      deps.logger?.info('digest summarization completed', {
        uid,
        promptVersion: PROMPT_VERSION,
        ...counts,
      });
      return { summaries, promptVersion: PROMPT_VERSION, counts };
    },
  };
}
