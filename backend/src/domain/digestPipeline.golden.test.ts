import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_TOKENS_PER_EMAIL,
  createDigestSummarizer,
  MAX_INPUT_TOKENS_PER_DIGEST,
  PROMPT_OVERHEAD_TOKENS,
  type SummarizerPort,
  type SummaryCacheStore,
} from './digestPipeline.js';
import type { Email } from './email.js';
import { estimateTokens } from './emailText.js';
import { categorizeByHeuristics } from './senderHeuristics.js';
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

  it('stays within the input-token cap with margin for a 50-email day', async () => {
    const { requests, digest } = goldenSummarizer();
    await digest.summarize('golden-user', emails);
    const request = requests[0];
    if (request === undefined) {
      throw new Error('no request recorded');
    }
    const promptTokens = estimateTokens(request.system) + estimateTokens(request.user);
    const perEmail = (promptTokens - PROMPT_OVERHEAD_TOKENS) / emails.length + BODY_TOKENS_PER_EMAIL;
    // The cost math in docs/digest-cost.md assumes 50 emails fit under the cap.
    expect(PROMPT_OVERHEAD_TOKENS + 50 * perEmail).toBeLessThanOrEqual(
      MAX_INPUT_TOKENS_PER_DIGEST,
    );
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
