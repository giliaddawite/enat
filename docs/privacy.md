# Privacy: what data lives where

Started under TICKET-102 to document the Gmail refresh-token storage it introduces; the full
data-inventory and retention-policy pass is TICKET-303. Update this file as part of any
change that adds, moves, or deletes a category of stored data.

## Gmail OAuth refresh tokens

**Never stored in plaintext, anywhere.** The refresh token Google issues during the Gmail
consent flow (TICKET-202) is the one credential in this system that can read a real mailbox,
so it gets its own storage path instead of living as a normal Firestore field.

- **Where:** Google Secret Manager, one secret per user
  (`gmail-refresh-token-<uid>`, where `uid` is the Google account's stable `sub` claim).
  `src/adapters/refreshTokenStore.ts` owns writes and reads; `src/adapters/secretManagerClient.ts`
  is the only file that talks to the Secret Manager SDK.
- **What Firestore holds instead:** the `users/{uid}` document's `refreshTokenRef` field —
  a Secret Manager version resource name (e.g.
  `projects/enat-prod/secrets/gmail-refresh-token-<uid>/versions/3`), never the token itself.
  A leaked Firestore export is useless without separate access to Secret Manager.
- **Encryption at rest:** Secret Manager encrypts all secret material with AES-256 using
  Google-managed encryption keys by default — this is not something the application
  configures or can get wrong. If a project-level compliance requirement later calls for
  customer-managed keys, Secret Manager supports a CMEK (Cloud KMS) configuration per secret
  without changing this adapter's interface.

### Key rotation

Two independent things rotate, and it matters which one is meant when someone says "rotate
the key":

1. **The encryption key protecting secret material at rest.** With Google-managed encryption
   keys (the default, and what this service uses), Google rotates the underlying key
   material transparently on its own schedule — there is nothing for Enat to operate. If
   this project moves to CMEK for compliance reasons, Cloud KMS key rotation is configured
   with a rotation period (e.g. 90 days) on the KMS key itself; Secret Manager continues to
   decrypt every existing secret version correctly because Cloud KMS keeps prior key
   versions available for decryption; no re-encryption of old secrets is required.
2. **The refresh token value itself**, which is an application-level rotation independent of
   the above. `RefreshTokenStore.put(uid, token)` adds a **new secret version** and then
   **destroys every superseded enabled version** (`src/adapters/refreshTokenStore.ts`), so
   an old plaintext token stops being redeemable — and billed — as soon as it is replaced.
   This happens automatically whenever TICKET-202's consent flow runs again for a user —
   first sign-in, or reconnecting after Google reports `invalid_grant` (revocation). The
   user's Firestore `refreshTokenRef` is updated to point at the new version.
   - Destruction failures are logged (`failed to destroy a superseded refresh token
     version`) and tolerated — the new token is already stored, and the next `put` sweeps
     up anything a failed cleanup left behind, because it destroys every enabled version
     except the one it just wrote. If that warning appears repeatedly, retire versions
     manually: `gcloud secrets versions list gmail-refresh-token-<uid>` and
     `gcloud secrets versions destroy` everything but the version Firestore references.

## Everything else (summary; expand under TICKET-303)

- **Email bodies:** never persisted server-side beyond the request that processes them
  (TICKET-104). Not addressed by this ticket.
- **Email summaries:** cached in Firestore keyed by `messageId` (TICKET-104). Not addressed
  by this ticket.
- **User profile (`users/{uid}`):** `uid`, `email`, `createdAt`, `locale`, `refreshTokenRef`
  — see `src/domain/user.ts`. No other PII fields exist on this document; do not add one
  without updating this file.
- **Logs:** structured JSON to stdout / Cloud Logging. Request IDs, status codes, and (for
  authentication) a fixed rejection-reason enum — never the ID token, the refresh token, or
  email content. See `docs/backend-runtime.md#logging` for the one known gap in this area.
