import { describe, expect, it } from 'vitest';
import { isSafeId } from './safeId.js';

describe('isSafeId', () => {
  it.each(['123456789012345678901', 'google-user-123', 'msg-1', 'digest-v1', '18f2a9c0b7d4e3f1'])(
    'accepts the URL-safe token %j',
    (id) => {
      expect(isSafeId(id)).toBe(true);
    },
  );

  it.each(['', 'a/b', '../escape', 'uid_2026-08-17', 'user id', 'uid\n', 'ሚስጥር'])(
    'rejects %j, which could escape or collide inside a document path',
    (id) => {
      expect(isSafeId(id)).toBe(false);
    },
  );
});
