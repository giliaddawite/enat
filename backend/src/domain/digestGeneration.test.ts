import { describe, expect, it } from 'vitest';
import { computeDigestETag, type Digest } from './digest.js';
import {
  createDigestGenerationService,
  GmailNotConnectedError,
  type DigestStore,
  type DigestUserPipeline,
} from './digestGeneration.js';
import type { DigestSummarizer } from './digestPipeline.js';
import type { Email } from './email.js';
import type { GmailSyncService } from './gmailSync.js';
import type { User } from './user.js';

const USER: User = {
  uid: 'uid-1',
  email: 'mom@example.com',
  createdAt: '2020-01-01T00:00:00.000Z',
  locale: 'am',
  refreshTokenRef: 'secret-ref',
};

const NOW = () => new Date('2026-08-17T06:30:00.000Z');

const EMAIL: Email = {
  id: 'msg-1',
  threadId: 'thread-1',
  from: 'sister@gmail.com',
  subject: 'Hi',
  snippet: '',
  receivedAt: '2026-08-17T05:00:00.000Z',
  labels: [],
  bodyText: null,
};

function fakeGmailSync(
  emails: readonly Email[] = [EMAIL],
): GmailSyncService & { readonly syncInboxCalls: string[] } {
  const syncInboxCalls: string[] = [];
  return {
    syncInboxCalls,
    syncInbox: (uid) => {
      syncInboxCalls.push(uid);
      return Promise.resolve({ kind: 'incremental' as const, emails, historyId: 'h1' });
    },
    fetchBodies: () => Promise.resolve(new Map()),
  };
}

function fakeSummarizer(): DigestSummarizer & {
  readonly summarizeCalls: { uid: string; emails: readonly Email[] }[];
} {
  const summarizeCalls: { uid: string; emails: readonly Email[] }[] = [];
  return {
    summarizeCalls,
    summarize: (uid, emails) => {
      summarizeCalls.push({ uid, emails });
      return Promise.resolve({
        summaries: emails.map((e) => ({
          messageId: e.id,
          category: 'family_personal' as const,
          summary: 'ደህና ናት',
          urgent: false,
          source: 'llm' as const,
          promptVersion: 'digest-v1',
        })),
        promptVersion: 'digest-v1',
        counts: { fromCache: 0, fromLlm: emails.length, heuristicOnly: 0 },
      });
    },
  };
}

function fakeDigestStore(seed: Digest | null = null): DigestStore & { saved: Digest[] } {
  const saved: Digest[] = [];
  let stored = seed;
  return {
    saved,
    get: () => Promise.resolve(stored),
    save: (digest) => {
      stored = digest;
      saved.push(digest);
      return Promise.resolve();
    },
  };
}

describe('createDigestGenerationService', () => {
  it('syncs, summarizes, assembles and persists a fresh digest', async () => {
    const gmailSync = fakeGmailSync();
    const summarizer = fakeSummarizer();
    const digests = fakeDigestStore();
    const service = createDigestGenerationService({
      digests,
      buildPipeline: (): DigestUserPipeline => ({ gmailSync, summarizer }),
      now: NOW,
    });

    const result = await service.generate(USER);

    expect(result.persisted).toBe(true);
    expect(result.digest.emailCount).toBe(1);
    expect(result.digest.date).toBe('2026-08-17');
    expect(digests.saved).toHaveLength(1);
    expect(gmailSync.syncInboxCalls).toEqual(['uid-1']);
    expect(summarizer.summarizeCalls).toEqual([{ uid: 'uid-1', emails: [EMAIL] }]);
  });

  it('skips the write when a rerun produces identical content', async () => {
    const gmailSync = fakeGmailSync();
    const summarizer = fakeSummarizer();
    const digests = fakeDigestStore();
    const service = createDigestGenerationService({
      digests,
      buildPipeline: (): DigestUserPipeline => ({ gmailSync, summarizer }),
      now: NOW,
    });

    const first = await service.generate(USER);
    const second = await service.generate(USER);

    expect(first.persisted).toBe(true);
    expect(second.persisted).toBe(false);
    expect(digests.saved).toHaveLength(1);
    // The unchanged rerun still costs a sync + a summarize call — cost safety comes from
    // Gmail's incremental sync and the summarizer's own per-messageId cache, not from
    // skipping the pipeline (see digest-cost.md) — but the write, and generatedAt, do not move.
    expect(gmailSync.syncInboxCalls).toHaveLength(2);
    expect(second.digest.generatedAt).toBe(first.digest.generatedAt);
  });

  it('persists again, keeping the same document, when new mail changes the content', async () => {
    const digests = fakeDigestStore();
    const firstSync = fakeGmailSync([EMAIL]);
    const firstSummarizer = fakeSummarizer();
    const firstService = createDigestGenerationService({
      digests,
      buildPipeline: (): DigestUserPipeline => ({
        gmailSync: firstSync,
        summarizer: firstSummarizer,
      }),
      now: NOW,
    });
    await firstService.generate(USER);

    const secondEmail: Email = { ...EMAIL, id: 'msg-2' };
    const secondSync = fakeGmailSync([EMAIL, secondEmail]);
    const secondSummarizer = fakeSummarizer();
    const secondService = createDigestGenerationService({
      digests,
      buildPipeline: (): DigestUserPipeline => ({
        gmailSync: secondSync,
        summarizer: secondSummarizer,
      }),
      now: () => new Date('2026-08-17T07:00:00.000Z'),
    });

    const result = await secondService.generate(USER);

    expect(result.persisted).toBe(true);
    expect(result.digest.emailCount).toBe(2);
    expect(digests.saved).toHaveLength(2);
    expect(computeDigestETag(digests.saved[1] as Digest)).not.toBe(
      computeDigestETag(digests.saved[0] as Digest),
    );
  });

  it('propagates GmailNotConnectedError from buildPipeline without touching the store', async () => {
    const digests = fakeDigestStore();
    const service = createDigestGenerationService({
      digests,
      buildPipeline: () => {
        throw new GmailNotConnectedError(USER.uid);
      },
      now: NOW,
    });

    await expect(service.generate(USER)).rejects.toBeInstanceOf(GmailNotConnectedError);
    expect(digests.saved).toHaveLength(0);
  });
});
