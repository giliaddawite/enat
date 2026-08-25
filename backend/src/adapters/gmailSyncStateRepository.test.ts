import { describe, expect, it } from 'vitest';
import { captureLogs } from '../testing/httpTestServer.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createFirestoreGmailSyncStateStore } from './gmailSyncStateRepository.js';

const NOW = () => new Date('2026-08-24T08:00:00.000Z');
const UID = 'google-user-123';

describe('createFirestoreGmailSyncStateStore', () => {
  it('returns null for a user who has never synced', async () => {
    const { firestore } = createFakeFirestore();
    const store = createFirestoreGmailSyncStateStore(firestore, { now: NOW });

    await expect(store.getHistoryId(UID)).resolves.toBeNull();
  });

  it('creates the watermark document on first sync', async () => {
    const { firestore, documents } = createFakeFirestore();
    const store = createFirestoreGmailSyncStateStore(firestore, { now: NOW });

    await store.setHistoryId(UID, 'history-42');

    expect(documents[`gmailSyncState/${UID}`]).toEqual({
      historyId: 'history-42',
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
    await expect(store.getHistoryId(UID)).resolves.toBe('history-42');
  });

  it('updates the existing watermark on later syncs', async () => {
    const { firestore, documents } = createFakeFirestore({
      [`gmailSyncState/${UID}`]: { historyId: 'history-42', updatedAt: 'earlier' },
    });
    const store = createFirestoreGmailSyncStateStore(firestore, { now: NOW });

    await store.setHistoryId(UID, 'history-43');

    expect(documents[`gmailSyncState/${UID}`]).toEqual({
      historyId: 'history-43',
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
  });

  it('treats a corrupt document as absent so the next sync self-heals with a full sync', async () => {
    const { firestore } = createFakeFirestore({
      [`gmailSyncState/${UID}`]: { historyId: 42 },
    });
    const { logger, entries } = captureLogs();
    const store = createFirestoreGmailSyncStateStore(firestore, { now: NOW, logger });

    await expect(store.getHistoryId(UID)).resolves.toBeNull();

    expect(entries.some((entry) => entry.severity === 'WARNING' && entry.uid === UID)).toBe(true);
  });
});
