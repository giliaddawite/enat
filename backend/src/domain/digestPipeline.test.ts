import { describe, expect, it } from 'vitest';
import {
  BODY_TOKENS_PER_EMAIL,
  createDigestSummarizer,
  heuristicSummary,
  parseLlmBatchResponse,
  planDigestBatch,
  PROMPT_OVERHEAD_TOKENS,
  type SummarizerPort,
  type SummaryCacheStore,
} from './digestPipeline.js';
import type { Email } from './email.js';
import { PROMPT_VERSION } from './summarizationPrompt.js';
import type { CacheableEmailSummary, EmailSummary } from './summary.js';

const UID = 'google-user-123';
const TODAY = '2026-08-25';

function email(id: string, overrides: Partial<Email> = {}): Email {
  return {
    id,
    threadId: `thread-${id}`,
    from: `${id}@sender.example`,
    subject: `subject ${id}`,
    snippet: `snippet ${id}`,
    receivedAt: '2026-08-24T15:00:00.000Z',
    labels: ['INBOX'],
    bodyText: null,
    ...overrides,
  };
}

function replyFor(emails: readonly Email[], overrides: Record<string, object> = {}): string {
  return JSON.stringify({
    summaries: emails.map((item) => ({
      messageId: item.id,
      category: 'important',
      summary: `ማጠቃለያ ${item.id}`,
      urgent: false,
      ...overrides[item.id],
    })),
  });
}

/** Scripted summarizer: returns replies in sequence and records every request. */
function fakeSummarizer(replies: readonly (string | Error)[]) {
  const requests: { system: string; user: string; maxOutputTokens: number }[] = [];
  const summarizer: SummarizerPort = {
    complete(request) {
      requests.push(request);
      const reply = replies[requests.length - 1];
      if (reply === undefined) {
        throw new Error(`test misconfiguration: no scripted reply ${requests.length}`);
      }
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { summarizer, requests };
}

function fakeCache(seed: readonly EmailSummary[] = []) {
  const stored = new Map(seed.map((summary) => [summary.messageId, summary]));
  const writes: CacheableEmailSummary[] = [];
  const cache: SummaryCacheStore = {
    getMany(_uid, messageIds) {
      const hits = new Map<string, EmailSummary>();
      for (const id of messageIds) {
        const hit = stored.get(id);
        if (hit !== undefined) {
          hits.set(id, hit);
        }
      }
      return Promise.resolve(hits);
    },
    setMany(_uid, summaries) {
      writes.push(...summaries);
      return Promise.resolve();
    },
  };
  return { cache, writes };
}

function fakeBodies(bodies: Record<string, string> = {}) {
  const calls: { ids: readonly string[]; maxTokensPerBody: number }[] = [];
  const fetchBodies = (ids: readonly string[], maxTokensPerBody: number) => {
    calls.push({ ids, maxTokensPerBody });
    return Promise.resolve(
      new Map(ids.filter((id) => bodies[id] !== undefined).map((id) => [id, bodies[id] ?? ''])),
    );
  };
  return { fetchBodies, calls };
}

function summarizerWith(
  replies: readonly (string | Error)[],
  options: {
    seed?: readonly EmailSummary[];
    bodies?: Record<string, string>;
    maxInputTokens?: number;
  } = {},
) {
  const scripted = fakeSummarizer(replies);
  const { cache, writes } = fakeCache(options.seed);
  const { fetchBodies, calls } = fakeBodies(options.bodies);
  const digest = createDigestSummarizer({
    summarizer: scripted.summarizer,
    cache,
    fetchBodies,
    today: () => TODAY,
    ...(options.maxInputTokens === undefined ? {} : { maxInputTokens: options.maxInputTokens }),
  });
  return { digest, requests: scripted.requests, writes, bodyCalls: calls };
}

describe('planDigestBatch', () => {
  it('sends everything to the LLM when the budget allows', () => {
    const emails = [email('a'), email('b')];
    const plan = planDigestBatch(emails);
    expect(plan.llm).toEqual(emails);
    expect(plan.heuristicOnly).toEqual([]);
  });

  it('overflows the oldest emails to heuristics when the cap bites', () => {
    const emails = [email('a'), email('b'), email('c')];
    // Room for roughly two email blocks beyond the prompt overhead.
    const cap = PROMPT_OVERHEAD_TOKENS + 2 * (BODY_TOKENS_PER_EMAIL + 60);
    const plan = planDigestBatch(emails, cap);
    expect(plan.llm.map((item) => item.id)).toEqual(['a', 'b']);
    expect(plan.heuristicOnly.map((item) => item.id)).toEqual(['c']);
  });

  it('sends nothing to the LLM when even one email cannot fit', () => {
    const plan = planDigestBatch([email('a')], PROMPT_OVERHEAD_TOKENS);
    expect(plan.llm).toEqual([]);
    expect(plan.heuristicOnly.map((item) => item.id)).toEqual(['a']);
  });
});

describe('parseLlmBatchResponse', () => {
  const ids = new Set(['a', 'b']);

  it('parses a well-formed reply', () => {
    const result = parseLlmBatchResponse(replyFor([email('a'), email('b')]), ids);
    expect(result.kind).toBe('parsed');
    if (result.kind === 'parsed') {
      expect([...result.items.keys()]).toEqual(['a', 'b']);
    }
  });

  it('tolerates prose and code fences around the JSON object', () => {
    const wrapped = '```json\n' + replyFor([email('a')]) + '\n```\nDone!';
    expect(parseLlmBatchResponse(wrapped, ids).kind).toBe('parsed');
  });

  it('rejects a reply with no JSON object', () => {
    expect(parseLlmBatchResponse('sorry, I cannot help', ids).kind).toBe('invalid');
  });

  it('rejects malformed JSON', () => {
    expect(parseLlmBatchResponse('{"summaries": [', ids).kind).toBe('invalid');
  });

  it('rejects an unknown category', () => {
    const reply = replyFor([email('a')], { a: { category: 'spam' } });
    expect(parseLlmBatchResponse(reply, ids).kind).toBe('invalid');
  });

  it('rejects a hallucinated message id', () => {
    const reply = replyFor([email('a'), email('zzz')]);
    expect(parseLlmBatchResponse(reply, ids).kind).toBe('invalid');
  });

  it('rejects an empty summary', () => {
    const reply = replyFor([email('a')], { a: { summary: '   ' } });
    expect(parseLlmBatchResponse(reply, ids).kind).toBe('invalid');
  });

  it('keeps the first entry when an id is duplicated', () => {
    const duplicated = JSON.stringify({
      summaries: [
        { messageId: 'a', category: 'important', summary: 'first', urgent: true },
        { messageId: 'a', category: 'promotions_other', summary: 'second', urgent: false },
      ],
    });
    const result = parseLlmBatchResponse(duplicated, ids);
    expect(result.kind).toBe('parsed');
    if (result.kind === 'parsed') {
      expect(result.items.get('a')?.summary).toBe('first');
    }
  });
});

describe('createDigestSummarizer', () => {
  it('summarizes a batch in one LLM call and caches the results', async () => {
    const emails = [email('a'), email('b')];
    const { digest, requests, writes } = summarizerWith([replyFor(emails)]);

    const result = await digest.summarize(UID, emails);

    expect(requests).toHaveLength(1);
    expect(result.summaries.map((s) => s.source)).toEqual(['llm', 'llm']);
    expect(result.summaries[0]?.promptVersion).toBe(PROMPT_VERSION);
    expect(result.counts).toEqual({ fromCache: 0, fromLlm: 2, heuristicOnly: 0 });
    expect(writes.map((s) => s.messageId)).toEqual(['a', 'b']);
  });

  it('makes no LLM call and fetches no bodies when every email is cached', async () => {
    const cachedSummary: EmailSummary = {
      messageId: 'a',
      category: 'bills_accounts',
      summary: 'ማጠቃለያ',
      urgent: false,
      source: 'cache',
      promptVersion: PROMPT_VERSION,
    };
    const { digest, requests, bodyCalls } = summarizerWith([], { seed: [cachedSummary] });

    const result = await digest.summarize(UID, [email('a')]);

    expect(requests).toHaveLength(0);
    expect(bodyCalls).toHaveLength(0);
    expect(result.summaries).toEqual([cachedSummary]);
    expect(result.counts).toEqual({ fromCache: 1, fromLlm: 0, heuristicOnly: 0 });
  });

  it('fetches bodies only for emails planned for the LLM, at the per-email budget', async () => {
    const emails = [email('a'), email('b'), email('c')];
    const cap = PROMPT_OVERHEAD_TOKENS + 2 * (BODY_TOKENS_PER_EMAIL + 60);
    const { digest, bodyCalls, requests } = summarizerWith([replyFor([email('a'), email('b')])], {
      bodies: { a: 'body of a', b: 'body of b' },
      maxInputTokens: cap,
    });

    await digest.summarize(UID, emails);

    expect(bodyCalls).toEqual([{ ids: ['a', 'b'], maxTokensPerBody: BODY_TOKENS_PER_EMAIL }]);
    expect(requests[0]?.user).toContain('body of a');
    expect(requests[0]?.user).toContain('body of b');
  });

  it('gives overflow emails category-only treatment without touching the LLM', async () => {
    const emails = [email('a'), email('b', { from: 'billing@clinic.example' })];
    const cap = PROMPT_OVERHEAD_TOKENS + BODY_TOKENS_PER_EMAIL + 60;
    const { digest, requests } = summarizerWith([replyFor([email('a')])], {
      maxInputTokens: cap,
    });

    const result = await digest.summarize(UID, emails);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.user).not.toContain('subject b');
    expect(result.summaries[1]).toEqual({
      messageId: 'b',
      category: 'bills_accounts',
      summary: null,
      urgent: false,
      source: 'heuristic',
      promptVersion: null,
    });
    expect(result.counts.heuristicOnly).toBe(1);
  });

  it('retries once on a malformed reply, echoing it, and uses the retried result', async () => {
    const emails = [email('a')];
    const { digest, requests, writes } = summarizerWith([
      'not json at all',
      replyFor(emails),
    ]);

    const result = await digest.summarize(UID, emails);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.user).toContain('could not be parsed');
    expect(requests[1]?.user).toContain('not json at all');
    expect(result.summaries[0]?.source).toBe('llm');
    expect(writes).toHaveLength(1);
  });

  it('falls back to heuristics after the retry also fails, and caches nothing', async () => {
    const emails = [email('a', { from: 'Selam <selam@gmail.com>' })];
    const { digest, requests, writes } = summarizerWith(['nope', 'still nope']);

    const result = await digest.summarize(UID, emails);

    expect(requests).toHaveLength(2);
    expect(writes).toHaveLength(0);
    expect(result.summaries[0]).toMatchObject({
      category: 'family_personal',
      summary: null,
      source: 'heuristic',
    });
  });

  it('falls back to heuristics when the LLM call itself fails', async () => {
    const emails = [email('a')];
    const { digest, writes } = summarizerWith([new Error('api unavailable')]);

    const result = await digest.summarize(UID, emails);

    expect(result.summaries[0]?.source).toBe('heuristic');
    expect(writes).toHaveLength(0);
  });

  it('covers an email the valid reply skipped with a heuristic result', async () => {
    const emails = [email('a'), email('b')];
    const { digest, writes } = summarizerWith([replyFor([email('a')])]);

    const result = await digest.summarize(UID, emails);

    expect(result.summaries.map((s) => s.source)).toEqual(['llm', 'heuristic']);
    expect(writes.map((s) => s.messageId)).toEqual(['a']);
  });

  it('mixes cache, LLM and heuristic sources while preserving input order', async () => {
    const cachedSummary: EmailSummary = {
      messageId: 'b',
      category: 'important',
      summary: 'ማጠቃለያ ለ',
      urgent: true,
      source: 'cache',
      promptVersion: PROMPT_VERSION,
    };
    const emails = [email('a'), email('b'), email('c'), email('d')];
    const cap = PROMPT_OVERHEAD_TOKENS + 2 * (BODY_TOKENS_PER_EMAIL + 60);
    const { digest } = summarizerWith([replyFor([email('a'), email('c')])], {
      seed: [cachedSummary],
      maxInputTokens: cap,
    });

    const result = await digest.summarize(UID, emails);

    expect(result.summaries.map((s) => [s.messageId, s.source])).toEqual([
      ['a', 'llm'],
      ['b', 'cache'],
      ['c', 'llm'],
      ['d', 'heuristic'],
    ]);
    expect(result.counts).toEqual({ fromCache: 1, fromLlm: 2, heuristicOnly: 1 });
  });

  it('does nothing for an empty digest', async () => {
    const { digest, requests, bodyCalls, writes } = summarizerWith([]);

    const result = await digest.summarize(UID, []);

    expect(result.summaries).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(bodyCalls).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});

describe('heuristicSummary', () => {
  it('never claims urgency and carries no prompt version', () => {
    const summary = heuristicSummary(email('a'));
    expect(summary).toMatchObject({ urgent: false, summary: null, promptVersion: null });
  });
});
