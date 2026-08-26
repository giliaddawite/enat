import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_TOKENS_PER_EMAIL,
  createDigestSummarizer,
  MAX_INPUT_TOKENS_PER_DIGEST,
  MAX_OUTPUT_TOKENS_PER_DIGEST,
  PROMPT_OVERHEAD_TOKENS,
  type SummarizerPort,
  type SummaryCacheStore,
} from './digestPipeline.js';
import type { Email } from './email.js';
import { estimateTokens } from './emailText.js';
import { categorizeByHeuristics } from './senderHeuristics.js';
import { renderEmailBlock } from './summarizationPrompt.js';
import type { EmailSummary } from './summary.js';

/**
 * Golden-file tests (TICKET-104): fixed email fixtures through the whole pipeline, with
 * the Claude reply replayed from a recorded fixture. The prompt snapshot pins the exact
 * bytes sent to the model — any prompt-template change fails here until the golden is
 * regenerated (vitest -u) in the same commit, alongside a PROMPT_VERSION bump and
 * re-recorded reply/expectation fixtures.
 */

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./goldens/${name}`, import.meta.url), 'utf8')) as T;
}

const emails = loadJson<Email[]>('digestEmails.json');
const bodies = loadJson<Record<string, string>>('digestBodies.json');
const claudeReply = readFileSync(
  new URL('./goldens/claudeReply.json', import.meta.url),
  'utf8',
);
const expectedSummaries = loadJson<EmailSummary[]>('expectedSummaries.json');

const TODAY = '2026-08-25';

function goldenSummarizer() {
  const requests: { system: string; user: string; maxOutputTokens: number }[] = [];
  const summarizer: SummarizerPort = {
    complete(request) {
      requests.push(request);
      return Promise.resolve(claudeReply);
    },
  };
  const emptyCache: SummaryCacheStore = {
    getMany: () => Promise.resolve(new Map()),
    setMany: () => Promise.resolve(),
  };
  const digest = createDigestSummarizer({
    summarizer,
    cache: emptyCache,
    fetchBodies: (ids) =>
      Promise.resolve(new Map(ids.map((id) => [id, bodies[id] ?? '']))),
    today: () => TODAY,
    nonce: () => 'goldnonce',
  });
  return { digest, requests };
}

describe('digest pipeline goldens', () => {
  it('produces the expected category for every fixture email', async () => {
    const { digest } = goldenSummarizer();
    const result = await digest.summarize('golden-user', emails);
    expect(result.summaries).toEqual(expectedSummaries);
  });

  it('sends the model exactly the golden prompt', async () => {
    const { digest, requests } = goldenSummarizer();
    await digest.summarize('golden-user', emails);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) {
      throw new Error('no request recorded');
    }
    await expect(`${request.system}\n\n=== USER ===\n\n${request.user}`).toMatchFileSnapshot(
      './goldens/digestPrompt.golden.txt',
    );
  });

  it('admits a 50-email day under the input cap, as the planner costs emails', () => {
    // The planner's own per-email estimate for the heaviest fixture: envelope without a
    // body, plus the full per-email body budget — exactly what planDigestBatch charges.
    const heaviest = Math.max(
      ...emails.map(
        (email) =>
          estimateTokens(renderEmailBlock({ ...email, bodyText: null, snippet: '' }, 0, 'nnnnnnnn')) +
          BODY_TOKENS_PER_EMAIL,
      ),
    );
    // The cost math in docs/digest-cost.md assumes 50 typical emails fit under the cap.
    expect(PROMPT_OVERHEAD_TOKENS + 50 * heaviest).toBeLessThanOrEqual(
      MAX_INPUT_TOKENS_PER_DIGEST,
    );
  });

  it('keeps the worst-case digest at or under the $0.05 budget on Haiku pricing', async () => {
    const { requests, digest } = goldenSummarizer();
    await digest.summarize('golden-user', emails);
    const request = requests[0];
    if (request === undefined) {
      throw new Error('no request recorded');
    }
    expect(request.maxOutputTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS_PER_DIGEST);
    // claude-haiku-4-5: $1/MTok in, $5/MTok out — the model documented in docs/digest-cost.md.
    const worstCaseDollars =
      (MAX_INPUT_TOKENS_PER_DIGEST * 1 + MAX_OUTPUT_TOKENS_PER_DIGEST * 5) / 1_000_000;
    expect(worstCaseDollars).toBeLessThanOrEqual(0.05);
  });

  it('assigns the expected category to every fixture even on the heuristic-only path', () => {
    const categories = Object.fromEntries(
      emails.map((email) => [email.id, categorizeByHeuristics(email)]),
    );
    expect(categories).toEqual({
      'msg-doctor': 'important',
      'msg-bank': 'bills_accounts',
      'msg-daughter': 'family_personal',
      'msg-church': 'important',
      'msg-promo': 'promotions_other',
    });
  });
});
