import { describe, expect, it, vi } from 'vitest';
import { computeDigestETag, type Digest } from './digest.js';
import {
  createDigestGenerationService,
  GmailNotConnectedError,
  withSingleFlightPerUser,
  type DigestGenerationResult,
  type DigestGenerationService,
  type DigestStore,
  type DigestUserPipeline,
} from './digestGeneration.js';
import type { DigestSummarizer } from './digestPipeline.js';
import { SingleFlightTimeoutError } from './singleFlight.js';
import type { Email } from './email.js';
import type { GmailSyncService } from './gmailSync.js';
import type { User } from './user.js';
import { captureLogs } from '../testing/httpTestServer.js';

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

describe('createDigestGenerationService logging', () => {
  it('reports uid, date and email count for a fresh run — never a summary', async () => {
    const logs = captureLogs();
    const service = createDigestGenerationService({
      digests: fakeDigestStore(),
      buildPipeline: (): DigestUserPipeline => ({
        gmailSync: fakeGmailSync(),
        summarizer: fakeSummarizer(),
      }),
      now: NOW,
      logger: logs.logger,
    });

    await service.generate(USER);

    expect(logs.entries.find((entry) => entry.message === 'digest generated')).toMatchObject({
      severity: 'INFO',
      uid: 'uid-1',
      date: '2026-08-17',
      emailCount: 1,
    });
    expect(JSON.stringify(logs.entries)).not.toContain('ደህና ናት');
  });

  it('reports the skipped write when a rerun changes nothing', async () => {
    const logs = captureLogs();
    const service = createDigestGenerationService({
      digests: fakeDigestStore(),
      buildPipeline: (): DigestUserPipeline => ({
        gmailSync: fakeGmailSync(),
        summarizer: fakeSummarizer(),
      }),
      now: NOW,
      logger: logs.logger,
    });

    await service.generate(USER);
    await service.generate(USER);

    expect(
      logs.entries.find(
        (entry) => entry.message === 'digest generation found no change; skipped write',
      ),
    ).toMatchObject({ severity: 'INFO', uid: 'uid-1', date: '2026-08-17' });
  });
});

describe('withSingleFlightPerUser', () => {
  const OTHER_USER: User = { ...USER, uid: 'uid-2', email: 'sister@example.com' };
  const RESULT: DigestGenerationResult = {
    digest: {
      date: '2026-08-17',
      userId: USER.uid,
      sections: [],
      generatedAt: '2026-08-17T06:30:00.000Z',
      emailCount: 0,
    },
    persisted: true,
  };

  /** An inner service whose runs complete only when the test says so, so two calls are
   * provably concurrent rather than merely close together. */
  function gatedService(outcome: DigestGenerationResult | Error = RESULT) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async (): Promise<DigestGenerationResult> => {
      await gate;
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    });
    const service: DigestGenerationService = { generate };
    return { service, generate, release: () => release() };
  }

  it('runs the pipeline once for two concurrent generates for one uid and gives both the result', async () => {
    const inner = gatedService();
    const guarded = withSingleFlightPerUser(inner.service);

    const first = guarded.generate(USER);
    const second = guarded.generate(USER);
    inner.release();

    await expect(Promise.all([first, second])).resolves.toEqual([RESULT, RESULT]);
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it('runs two different uids independently', async () => {
    const inner = gatedService();
    const guarded = withSingleFlightPerUser(inner.service);

    const mom = guarded.generate(USER);
    const sister = guarded.generate(OTHER_USER);
    inner.release();

    await Promise.all([mom, sister]);
    expect(inner.generate).toHaveBeenCalledTimes(2);
    expect(inner.generate).toHaveBeenCalledWith(USER);
    expect(inner.generate).toHaveBeenCalledWith(OTHER_USER);
  });

  it('propagates the first run failure to every waiter and clears the entry so the next call runs again', async () => {
    const generate = vi
      .fn<(user: User) => Promise<DigestGenerationResult>>()
      .mockRejectedValueOnce(new Error('gmail api down'))
      .mockResolvedValueOnce(RESULT);
    const guarded = withSingleFlightPerUser({ generate });

    const first = guarded.generate(USER);
    const second = guarded.generate(USER);
    await expect(first).rejects.toThrow('gmail api down');
    await expect(second).rejects.toThrow('gmail api down');

    await expect(guarded.generate(USER)).resolves.toEqual(RESULT);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('logs a join with the uid only, never the digest, when a second call coalesces', async () => {
    const logs = captureLogs();
    const inner = gatedService();
    const guarded = withSingleFlightPerUser(inner.service, { logger: logs.logger });

    const first = guarded.generate(USER);
    const second = guarded.generate(USER);
    inner.release();
    await Promise.all([first, second]);

    const joins = logs.entries.filter((entry) =>
      entry.message.startsWith('digest generation joined'),
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ severity: 'INFO', uid: 'uid-1' });
    expect(Object.keys(joins[0] ?? {})).not.toContain('digest');
  });

  it('releases the waiters of a hung run at the deadline and lets the next call start afresh', async () => {
    const armed: (() => void)[] = [];
    const generate = vi
      .fn<(user: User) => Promise<DigestGenerationResult>>()
      .mockImplementationOnce(() => new Promise<DigestGenerationResult>(() => undefined))
      .mockResolvedValueOnce(RESULT);
    const guarded = withSingleFlightPerUser(
      { generate },
      {
        timeoutMs: 50_000,
        setTimer: (callback) => armed.push(callback),
        clearTimer: () => undefined,
      },
    );

    const first = guarded.generate(USER);
    const second = guarded.generate(USER);
    for (const fire of armed.splice(0)) {
      fire();
    }

    await expect(first).rejects.toBeInstanceOf(SingleFlightTimeoutError);
    await expect(second).rejects.toBeInstanceOf(SingleFlightTimeoutError);
    await expect(guarded.generate(USER)).resolves.toEqual(RESULT);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
