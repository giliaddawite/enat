# Privacy: what data lives where

The data inventory and retention policy for Enat (TICKET-303). The subject is one person's
private mailbox, and CLAUDE.md calls protecting it the hardest rule in the repository. This
file is the authoritative statement of what is stored, where, for how long, and how it is
deleted. **Update it in the same change that adds, moves, or deletes a category of stored
data** — a store that is not in this table does not exist as far as the project's privacy
posture is concerned, which is exactly the problem.

Two facts frame everything below:

- **Email bodies are never persisted anywhere.** They are fetched from Gmail, held in the
  memory of one Cloud Run request, sent to the Claude API inside the summarization prompt,
  and gone when the request ends. No store in this document holds one.
- **What is persisted is derived data about mail** — sender, subject, an Amharic summary —
  and it is personal data in its own right. It is bounded by retention and reachable by a
  deletion path, both stated per store.

PII classes used in the tables:

| Class | Meaning |
| --- | --- |
| **identifier** | Identifies the user or a message without revealing content (Google `sub`, Gmail message id) |
| **contact** | Reaches a person: an email address, a phone number, a name |
| **mail metadata** | Who sent what, when: sender, subject, received time |
| **mail content** | Email body text, or anything derived from it — a summary, a category, an urgency flag, a Gmail snippet |
| **credential** | Lets its holder act as the user: refresh tokens, access tokens, ID tokens, auth codes |
| **none** | No personal data |

## Backend

Everything in this section runs in one GCP project (staging; production is TICKET-003) and
is reached only through the Cloud Run service. Firestore and Secret Manager encrypt all data
at rest with Google-managed keys by default (AES-256); the application neither configures
nor can misconfigure this. All traffic between the app, the service, Gmail, Claude,
Firestore and Secret Manager is TLS: Cloud Run terminates HTTPS, the Android client refuses
cleartext (`usesCleartextTraffic="false"`) and the Gradle build refuses a non-`https://`
API base URL, and the Anthropic client's base URL is pinned in code to
`https://api.anthropic.com` so no environment variable can redirect it. The Google SDKs
have equivalent environment hooks — `FIRESTORE_EMULATOR_HOST` redirects every Firestore
call unauthenticated to an arbitrary host, and `GOOGLE_SDK_NODE_LOGGING` / `GRPC_TRACE`
print request payloads, including Secret Manager's refresh-token payloads, to stderr —
so `loadConfig` refuses to boot in production if any of them is set
(`backend/src/config.ts`).

| Store | Collection / resource | Fields | PII class | Retention | Deletion path |
| --- | --- | --- | --- | --- | --- |
| Firestore | `users/{uid}` (`backend/src/adapters/usersRepository.ts`) | `uid` (Google `sub`), `email`, `createdAt`, `locale`, `refreshTokenRef` (a Secret Manager version *name*, never the token) | identifier, contact | Life of the account | Delete the document and the user's Secret Manager secret (below). `email` is reconciled from the verified ID token on every sign-in; no other personal field exists on this document and none may be added without updating this file. |
| Secret Manager | `gmail-refresh-token-{uid}` (`refreshTokenStore.ts`, `secretManagerClient.ts`) | The Gmail OAuth refresh token, one secret per user, one enabled version at a time | credential | Until replaced or revoked — see [Refresh token rotation](#gmail-oauth-refresh-tokens) | `RefreshTokenStore.put` destroys superseded versions automatically on every re-consent; manual: `gcloud secrets delete gmail-refresh-token-<uid>`, then revoke the grant at myaccount.google.com/permissions so the token is dead even if a copy survived. |
| Firestore | `digests/{uid}_{date}` (`digestRepository.ts`) | `date`, `userId`, `generatedAt`, `emailCount`, `expireAt`, and per email: `messageId`, `from`, `subject`, `summary` (Amharic, nullable), `urgent`, `receivedAt` | identifier, mail metadata, mail content (derived) | **30 days** — `expireAt` stamped at write time; the Firestore TTL policy in `infra/README.md` deletes the document | Automatic by TTL; manual per user: delete every document with id prefix `<uid>_`. |
| Firestore | `emailSummaries/{uid}_{promptVersion}_{messageId}` (`summaryCacheRepository.ts`) | `messageId`, `category`, `summary` (Amharic), `urgent`, `promptVersion`, `createdAt`, `expireAt` | identifier, mail content (derived) | **90 days** — `expireAt` stamped at write time; TTL policy as above | Automatic by TTL; manual per user: delete every document with id prefix `<uid>_`. Bumping `PROMPT_VERSION` orphans the previous version's documents, which then simply expire. |
| Firestore | `gmailSyncState/{uid}` (`gmailSyncStateRepository.ts`) | `historyId` (Gmail's opaque mailbox watermark), `updatedAt` | identifier | Life of the account; rewritten on every sync | Delete the document; the next sync is a full one. |
| Process memory | Gmail access-token cache (`gmailAccessTokens.ts`) | Short-lived Gmail access tokens, keyed by `refreshTokenRef` | credential | Until ~1 minute before the token's own expiry (~1 hour), or until the Cloud Run instance is reclaimed — the service scales to zero | Dies with the instance. Never written anywhere. |
| Process memory | Request pipeline (`gmailSync.ts`, `digestPipeline.ts`) | Email bodies (`format=full`, only for messages that will be summarized), snippets and headers (`format=metadata`) | mail content, mail metadata | Duration of one request | Garbage-collected with the request. **Never persisted, never logged.** |

### Why sender and subject are persisted

The digest document stores each email's `from` and `subject` because the Android digest
screen renders them: a card reading only "ማጠቃለያ" with no indication of who wrote is not
usable, and fetching them from Gmail at read time would put a Gmail call on the <300ms
read path and break the airplane-mode requirement. The trade is bounded by the **30-day**
TTL above, which is far longer than the read path ever looks back (`findLatestDigest` walks
days, not weeks) and short enough that the collection never becomes a mailbox index.

### Processors outside GCP

| Processor | What leaves GCP | What comes back | Retention there |
| --- | --- | --- | --- |
| **Anthropic (Claude API)** — `backend/src/adapters/claudeClient.ts`, prompt in `domain/summarizationPrompt.ts` | One prompt per digest batch containing, for each email to be summarized: its Gmail `messageId` (the correlation key the reply is matched on), sender, subject, received time, and the body text truncated to the per-email token budget (or the Gmail snippet when no body was fetched). On a malformed reply, one retry echoes up to 500 tokens of that reply back. Never the user's identity: no `uid` and no account email is sent. | Category, Amharic summary and urgency per email, schema-validated before use | Governed by Anthropic's API data policy for the account's plan; nothing is persisted by Enat on Anthropic's side. The SDK's own logging is disabled in code (`logLevel: 'off'`), so prompts cannot be dumped to stderr by an environment variable. |
| **Google (Gmail API, OAuth, JWKS)** | OAuth tokens and Gmail API requests for the user's own mailbox, under `gmail.readonly` + `gmail.modify` only | Mailbox data | Google's; the user owns the grant and can revoke it at any time. The Google Cloud SDKs (Firestore, Secret Manager) talk only to Google endpoints: their emulator-redirect and payload-logging environment variables are refused at boot in production (see above). |

### Logs (Cloud Logging)

Every request writes structured JSON to stdout; Cloud Run forwards it to Cloud Logging under
the project's default 30-day log retention. **The only identifiers permitted in a log line
are the `uid` (Google `sub`) and Gmail `messageId`s**, plus counts, durations, statuses,
request ids and fixed enums (an auth rejection reason, a category name). The following
never appear, and tests enforce the ones that can be tested:

- email bodies, snippets, subjects, senders, received times
- summaries and categories *of a specific email* (counts per category are fine)
- the user's email address
- any token: ID tokens, access tokens, refresh tokens, auth codes, `refreshTokenRef`
- request bodies, query strings, headers, client IP addresses (`requestLogging.ts`)
- the message or stack of an error raised by a library (`http/describeError.ts` renders
  every logged error, in the error handler and at every catch site that logs, as
  `{ name, code }` unless the class is one this repository defines — see
  `docs/backend-runtime.md#logging`)

If a new log line needs something not on the permitted list, the answer is a count or a
hash, not an exception to the list.

## Android

The app holds only what it needs to render every screen from cache with no network
(CLAUDE.md: offline-first). Nothing on the device may leave it through system backup:
`android:allowBackup="false"` disables Auto Backup, and `res/xml/data_extraction_rules.xml`
excludes every domain (`root`, `file`, `database`, `sharedpref`, `external`) from both
Android 12+ cloud backup and device-to-device transfer, which ignores `allowBackup`. The
Room database (`enat.db`) is not additionally encrypted: it sits in app-private storage on a
device whose lock screen and file-based encryption are the user's, and the data in it is a
subset of what the backend already holds under the retention above. Release builds run R8
with `isMinifyEnabled` and `isShrinkResources`, and strip `Log.v/d/i` entirely
(`proguard-rules.pro`); the APK contains no OAuth client secret — the server auth-code flow
exchanges codes on the backend (TICKET-202).

| Store | Table / key | Fields | PII class | Retention | Deletion path |
| --- | --- | --- | --- | --- | --- |
| Room `enat.db` | `cached_digest` (`DigestEntities.kt`) | `id` (singleton), `date`, `generatedAt`, `emailCount`, `etag` | none | Replaced by each successful sync | Clear app data / uninstall |
| Room `enat.db` | `digest_items` (`DigestEntities.kt`) | `messageId`, `category`, `sectionOrder`, `itemOrder`, `sender`, `subject`, `summary`, `urgent`, `receivedAt` | identifier, mail metadata, mail content (derived) | Replaced by each successful sync — exactly one digest is cached | Clear app data / uninstall |
| Room `enat.db` | `cached_verse` (`VerseEntity.kt`) | `id` (singleton), `date`, `reference`, `referenceAm`, `textEn`, `textAm`, `etag` | none (public-domain scripture) | Replaced by each successful sync | Clear app data / uninstall |
| Room `enat.db` | `family_contacts` (`FamilyContactEntity.kt`) | `id`, `name`, `phoneNumber` | contact | Until the user edits or removes the contact | In-app (Family settings), clear app data / uninstall. **Local only** — never synced to the backend. |
| SharedPreferences | `enat_setup` (`SetupStateRepository.kt`): `setup_complete`, `notification_permission_requested` | Two booleans | none | Life of the install | Clear app data / uninstall |
| Process memory | `SessionIdTokenProvider` (`IdTokenProvider.kt`) | The current Google ID token and its expiry | credential | Until ~5 minutes before the token's `exp`, capped at 1 hour, or until the server answers 401 | **Never persisted, never logged.** Re-minted silently via Credential Manager; the Google account itself is held by the OS, not the app. |
| Firebase Crashlytics | Crash reports | Stack traces, device model and OS version, app version | none, by rule | Firebase's default (90 days) | Disabled in debug builds and in any build without `google-services.json`; enabled in release only (`EnatApplication.kt`). **Rule: never call `setCustomKey`, `log` or `setUserId` with mail content, an email address or a token** — a crash report is a log line that leaves the project. |

Logging on the device follows the backend rule: `Log.e`/`Log.w` carry a fixed error kind and
an exception, never a token, auth code or account detail (`SetupViewModel.kt`), and
`Log.v/d/i` do not exist in release builds.

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
- **Least privilege:** the runtime service account holds exactly the Secret Manager
  permissions this store uses, bound by an IAM condition to the `gmail-refresh-token-`
  prefix — see `infra/README.md`.

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

## Deleting a user entirely

In this order, so nothing can be re-created by an in-flight request:

1. Revoke the Gmail grant at myaccount.google.com/permissions (the user) — every stored
   token becomes unusable regardless of what follows.
2. `gcloud secrets delete gmail-refresh-token-<uid>`.
3. Delete `users/<uid>`, `gmailSyncState/<uid>`, and every `digests` and `emailSummaries`
   document whose id begins with `<uid>_`.
4. On the device: clear app data or uninstall. The Room cache and preferences are the only
   on-device state; there is nothing in cloud backup to purge.

Cloud Logging entries naming the `uid` age out under the project's log retention; they
contain no mail content by the rules above.
