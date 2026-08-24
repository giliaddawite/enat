/** The internal record an authenticated request is resolved to. Mirrors the ticket's
 * Firestore `users` collection shape 1:1 so the adapter layer stays a thin mapping. */
export interface User {
  readonly uid: string;
  readonly email: string;
  /** ISO 8601. Stored as a string, not a Date, so the domain layer stays framework-free. */
  readonly createdAt: string;
  readonly locale: string;
  /**
   * Pointer to the user's encrypted Gmail OAuth refresh token (a Secret Manager secret
   * version name) — never the token itself. `null` until the user completes the Gmail
   * consent flow (TICKET-202).
   */
  readonly refreshTokenRef: string | null;
}

/** Amharic-first per CLAUDE.md; a user who hasn't set a preference yet gets it by default. */
const DEFAULT_LOCALE = 'am';

/**
 * Builds the record for a Google identity seen for the first time. Pure — the caller
 * supplies the clock, so account-creation timestamps are deterministic in tests and no
 * domain code reaches for `Date.now()` directly.
 */
export function newUserRecord(
  identity: { readonly googleUserId: string; readonly email: string },
  now: () => Date,
): User {
  return {
    uid: identity.googleUserId,
    email: identity.email,
    createdAt: now().toISOString(),
    locale: DEFAULT_LOCALE,
    refreshTokenRef: null,
  };
}
