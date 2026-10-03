# Infrastructure

Deployment configuration for the Enat backend.

| Path | Purpose |
| --- | --- |
| `cloudrun/service.staging.yaml` | Cloud Run service definition for staging |

The container image is built from `backend/Dockerfile`, with `backend/` as the build
context. The Dockerfile lives beside the code it builds so that `docker build backend`
works without repository-root context.

Only the staging service is defined here. The production service is added once TICKET-003
provisions the production project and service account — a second file copied from staging
before it can be applied would only drift.

## Placeholders

`service.staging.yaml` contains two placeholders that the deploy step substitutes:

- `IMAGE_PLACEHOLDER` — the digest-pinned Artifact Registry image, e.g.
  `us-central1-docker.pkg.dev/<project>/enat/backend@sha256:<digest>`.
- `PROJECT_ID_PLACEHOLDER` — the staging GCP project id. The `_PLACEHOLDER` suffix is
  load-bearing: a bare `PROJECT_ID` token would also match inside the `GCP_PROJECT_ID`
  env var name during global substitution.

## Deploying by hand

Requires the staging project and service account from TICKET-003. The automated path is
TICKET-002.

```sh
gcloud run services replace infra/cloudrun/service.staging.yaml --region us-central1
```

## Who may invoke the service

The Android app calls `/v1/*` directly with a Google ID token in `Authorization`, and a
phone has no Cloud Run IAM identity, so the service **must be publicly invokable**:
`roles/run.invoker` is granted to `allUsers`, and `ingress: all` lets the request in. That
makes the application-layer checks the entire boundary — there is no IAM gate behind them:

- **`/v1/*`** — `authenticate` (`backend/src/http/auth.ts`) verifies the Google ID token's
  signature against Google's JWKS, its issuer, audience (`GOOGLE_OAUTH_AUDIENCE`), `exp`,
  and required claims, then `rateLimit` applies the per-user budget. Every `/v1` route is
  registered behind both by construction (`app.ts`).
- **`/internal/digest-generate`** — `verifyPubSubPush` (`backend/src/http/pubsubPush.ts`)
  verifies the OIDC token Pub/Sub attaches to the push the same way (signature, issuer,
  expiry), with the audience pinned to `PUBSUB_PUSH_AUDIENCE` and the token's verified
  `email` required to equal `PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL` — the one service
  account the push subscription is configured to sign as. An arbitrary caller cannot obtain
  such a token, because only that service account's key can mint one with that audience.
  The check runs before the request body is parsed (the token is a header), and the body
  parser that follows it accepts at most 16kb — an unauthenticated caller never gets this
  service to read, let alone parse, what it sent. The route is not mounted at all when
  either variable is unset.
- **`/healthz`** is open and dependency-free, for Cloud Run's startup probe.
- Everything else — unmatched paths included — leaves through `notFound` and the error
  handler, which never include detail.

The `run.invoker` grant to the `enat-scheduler` service account below is therefore not
what protects `/internal` (anyone can invoke the URL); it is what lets the push *succeed*
at the IAM layer, and the token check is what decides whether it is honoured.

**Alternative, if the exposure is ever judged too wide:** split `/internal/*` into a second
Cloud Run service built from the same image (an env flag selecting which routes mount),
with `ingress: internal` and `run.invoker` granted only to `enat-scheduler`. That puts an
IAM gate in front of the token check at the cost of a second service to deploy and
monitor. It is not done today because the token check is already a complete
authentication of the caller, and one service is cheaper to run at zero.

## One instance, and why the rate limiter depends on it (TICKET-306)

`service.staging.yaml` pins `autoscaling.knative.dev/maxScale: '1'`. This is a deliberate
choice, not an oversight, and the per-user rate limiter relies on it:

- `createRateLimiter` (`backend/src/domain/rateLimiter.ts`) keeps each user's request
  window in **process memory**. Every Cloud Run instance therefore grants its own full
  budget, and a client whose requests land on N instances gets N × 60 req/min. With
  `maxScale: 1` there is exactly one window per user, so the 60 req/min figure in CLAUDE.md
  is the figure the deployed service enforces. The same holds for the smaller
  `POST /v1/digest/generate` budget (`DIGEST_GENERATE_RATE_LIMIT_PER_MINUTE`, default 2)
  and for the per-user in-flight guard that coalesces concurrent generations into one run.
- The service serves one household. `containerConcurrency: 80` on a single instance is far
  more than that household's traffic, so the pin costs nothing in capacity; a second
  instance would only ever appear during a cold-start overlap or a retry storm — exactly
  the moments the budget exists to bound.
- A cold start still resets the window (under-enforcement for one minute, never
  over-enforcement). Accepted: the limiter protects a budget, not a security boundary.

`backend/src/http/rateLimit.deployment.test.ts` reads every `cloudrun/service.*.yaml` and
fails if `maxScale` is anything but `'1'`, so the manifest and the limiter cannot drift
apart without someone changing both on purpose.

**If the app ever serves many users** and one instance is no longer enough, raising
`maxScale` must be preceded by replacing the limiter's window with a shared store: a
Firestore-backed window keyed by `uid` (one document per user per window, incremented with
a transaction or `FieldValue.increment`, with `expireAt` under a TTL policy like the other
collections above). That costs one Firestore write per request, which is why it is not done
for one household today. The `RateLimiter` port (`tryConsume(key)`) is already the seam; the
HTTP middleware and routes would not change.

## Prerequisites not yet in place

- **TICKET-003** — GCP projects, service accounts, Artifact Registry repository.

The deploy workflow (TICKET-002, `.github/workflows/deploy.yml`) already builds, pushes,
substitutes the placeholders, and applies this file on every push to `main` — but until
TICKET-003 provisions the project and secrets, this configuration is unapplied and the
runtime acceptance criteria in TICKET-101 (scale to zero, cold-start latency) cannot be
measured. See [`docs/backend-runtime.md`](../docs/backend-runtime.md).

## Firestore retention policies (TICKET-303)

Two collections hold data derived from the user's mail, and neither may keep it
indefinitely (see [`docs/privacy.md`](../docs/privacy.md)):

| Collection | What it holds | Retention | Written by |
| --- | --- | --- | --- |
| `digests` | one document per user per day: sender, subject and Amharic summary per email | 30 days | `backend/src/adapters/digestRepository.ts` |
| `emailSummaries` | one document per user, prompt version and message: category, summary, urgency | 90 days | `backend/src/adapters/summaryCacheRepository.ts` |

The repositories stamp every document with an `expireAt` timestamp at write time, computed
from the injected clock. Firestore deletes expired documents only when a **TTL policy** on
that field exists for the collection group, so the policy is part of provisioning the
project — without it, `expireAt` is just a field. Enable both (once per project; the
command is idempotent and takes a few minutes to become active):

```sh
gcloud firestore fields ttls update expireAt \
  --collection-group=digests --enable-ttl --project PROJECT_ID

gcloud firestore fields ttls update expireAt \
  --collection-group=emailSummaries --enable-ttl --project PROJECT_ID

# Verify: both should list `ttlConfig: state: ACTIVE` once provisioning completes.
gcloud firestore fields ttls list --project PROJECT_ID
```

Add `--database=<id>` to each command if the service uses a named database rather than
`(default)`. TTL deletion is best-effort and typically completes within 24 hours of
`expireAt`; the read path never depends on it (`findLatestDigest` looks back days, and the
summary cache is keyed so a missing document is simply re-summarized), so the only effect
of a missing policy is retention, which is exactly why it must be verified, not assumed.
Changing a retention period is a code change to the constant in the repository named
above, not a `gcloud` change: the policy only says *which field* expires a document.

**Existing documents.** Anything written before `expireAt` existed has no stamp and would
never be deleted by the policy. Both repositories tolerate such documents on read — they
are served normally, never regenerated or re-summarized — and backfill `expireAt` in
place, anchored on the document's own `generatedAt`/`createdAt`, so an old document ages
out on the same schedule as a new one the first time anything reads it. Documents nothing
reads again (a digest older than the read path's lookback, a summary for mail that left
the inbox) keep no stamp; if a clean slate is wanted instead of waiting, delete the two
collections wholesale — everything in them is derived and is regenerated on the next run,
at the cost of one Claude call per email still inside the digest window:

```sh
gcloud firestore bulk-delete --collection-ids=digests,emailSummaries --project PROJECT_ID
```

## Digest generation scheduling (TICKET-105)

Cloud Scheduler publishes to a Pub/Sub topic every morning; the topic's push subscription
calls `POST /internal/digest-generate` on the Cloud Run service. This route is deliberately
not part of `service.staging.yaml`'s env vars or the deploy workflow's placeholder
substitution — those are TICKET-002/003 territory, out of this ticket's `/backend` and
`/infra` scope — so it is documented here as `gcloud` commands, in the same "by hand until
the automation exists" spirit as the deploy step above.

**Why push, not a Cloud Run *job* on a poll loop:** a push subscription only ever costs a
Cloud Run invocation when Cloud Scheduler actually fires — no polling process, consistent
with CLAUDE.md's scale-to-zero rule. The alternative most consistent with "job", a Cloud Run
Job triggered by Scheduler directly, was passed over only because it would need its own
container entrypoint and IAM wiring separate from the API service already running the same
code; a push endpoint on the existing service reuses `createApp`'s dependency graph as-is.

Every step below needs the staging project and service accounts from TICKET-003 first.

```sh
# One-time: a dedicated service account Pub/Sub pushes as. Least privilege — this identity
# can invoke the Cloud Run service and nothing else.
gcloud iam service-accounts create enat-scheduler \
  --project PROJECT_ID \
  --display-name "Enat digest scheduler (Cloud Scheduler -> Pub/Sub push)"

gcloud run services add-iam-policy-binding enat-api-staging \
  --project PROJECT_ID --region us-central1 \
  --member "serviceAccount:enat-scheduler@PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/run.invoker

# The topic Cloud Scheduler publishes to.
gcloud pubsub topics create enat-digest-generate --project PROJECT_ID

# The push subscription. --push-auth-token-audience is the URL PUBSUB_PUSH_AUDIENCE must be
# set to on the Cloud Run service (see .env.example) — verifyPubSubPush checks the pushed
# OIDC token's `aud` claim against exactly this value.
gcloud pubsub subscriptions create enat-digest-generate-push \
  --project PROJECT_ID \
  --topic enat-digest-generate \
  --push-endpoint "https://<staging-service-url>/internal/digest-generate" \
  --push-auth-service-account "enat-scheduler@PROJECT_ID.iam.gserviceaccount.com" \
  --push-auth-token-audience "https://<staging-service-url>/internal/digest-generate"

# 6:30 AM America/New_York, daily. The message body is the one piece of per-user state this
# single-tenant deployment needs: the Google user id (Firestore `users` document id) to
# generate for. A future multi-user deployment would replace this with a small fan-out step
# that lists users and publishes one message per user instead of hand-editing this payload.
gcloud scheduler jobs create pubsub enat-digest-daily \
  --project PROJECT_ID --location us-central1 \
  --schedule "30 6 * * *" --time-zone "America/New_York" \
  --topic enat-digest-generate \
  --message-body '{"uid":"<moms-google-user-id>"}'
```

Environment variables (see `.env.example` for the full list):

- `PUBSUB_PUSH_AUDIENCE` and `PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL` are rendered into
  `service.staging.yaml` by the deploy workflow: the audience from the
  `PUBSUB_PUSH_AUDIENCE` GitHub secret (set it to the `--push-auth-token-audience` value
  above), the email derived from the project id — which is why the service account name
  `enat-scheduler` above is load-bearing. Do not set these by hand with
  `gcloud run services update`; the next deploy renders the YAML and would revert them.
- `CLAUDE_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — needed for the
  job itself to reach Gmail and Claude; `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` are the pair
  TICKET-202's consent flow issues the user's refresh token under. These are credentials,
  so they never appear as YAML values: `service.staging.yaml` mounts them from Secret
  Manager by reference (`secretKeyRef`, pinned to `latest`). The three secrets —
  `claude-api-key`, `google-oauth-client-id`, `google-oauth-client-secret` — must exist in
  the project and grant `roles/secretmanager.secretAccessor` to the runtime service
  account, or the rendered revision fails to start:

  ```sh
  gcloud secrets create claude-api-key --project PROJECT_ID --data-file=-  # then the key on stdin
  gcloud secrets add-iam-policy-binding claude-api-key --project PROJECT_ID \
    --member "serviceAccount:enat-api-staging@PROJECT_ID.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor
  # repeat for google-oauth-client-id and google-oauth-client-secret
  ```

  Rotation is `gcloud secrets versions add` with the new value — the `latest` pin means
  the next deployed revision picks it up with no manifest change.

Until all five are set, the service still boots and serves reads of already-generated
digests; `/internal/digest-generate` (missing `PUBSUB_PUSH_AUDIENCE`/
`PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL`) is simply not mounted, and
`POST /v1/digest/generate` (missing the other three) answers a clear 500 rather than
crash-looping the service — see `backend/src/composition.ts`.

The boundary for `/internal/digest-generate` is `verifyPubSubPush`, as described under
[Who may invoke the service](#who-may-invoke-the-service): the service is public, and the
pushed OIDC token's signature, audience, expiry and signer email are what admit a request.

## Runtime service account permissions (TICKET-303)

The runtime service account (`enat-api-staging@PROJECT_ID.iam.gserviceaccount.com`) needs
exactly three things beyond the `secretAccessor` grants on the three config secrets above.
Grant nothing broader — in particular not `roles/secretmanager.admin`, which would let a
compromised instance read every secret in the project, including the config secrets'
future versions and other users' tokens.

**1. Firestore.** `roles/datastore.user` — document reads and writes on `users`,
`digests`, `emailSummaries` and `gmailSyncState`. It carries no index, TTL-policy or
export permission, so the retention policies above cannot be altered from inside the
service.

```sh
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member "serviceAccount:enat-api-staging@PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/datastore.user
```

**2. Secret Manager, for the per-user Gmail refresh tokens.** `refreshTokenStore.ts` via
`secretManagerClient.ts` performs exactly these operations and no others:

| Operation | Permission | Resource |
| --- | --- | --- |
| `createSecret` (first consent for a user) | `secretmanager.secrets.create` | the **project** — a secret that does not exist yet has no resource of its own |
| `addSecretVersion` (store / rotate the token) | `secretmanager.versions.add` | `projects/<num>/secrets/gmail-refresh-token-<uid>` |
| `listSecretVersions` (find superseded versions) | `secretmanager.versions.list` | same |
| `accessSecretVersion` (mint a Gmail access token) | `secretmanager.versions.access` | same |
| `destroySecretVersion` (retire superseded versions) | `secretmanager.versions.destroy` | same |

Bundle those five into a custom role, then bind it at project level with an IAM condition
that limits the version operations to the `gmail-refresh-token-` prefix. The condition
must allow the project itself too, or `secrets.create` — whose resource is the project —
is denied. `<num>` is the numeric project number (`gcloud projects describe PROJECT_ID
--format 'value(projectNumber)'`), which is how Secret Manager names resources in IAM
conditions.

```sh
gcloud iam roles create enatRefreshTokenStore --project PROJECT_ID \
  --title "Enat refresh token store" \
  --description "Create per-user gmail-refresh-token-* secrets and manage their versions" \
  --permissions secretmanager.secrets.create,secretmanager.versions.add,secretmanager.versions.list,secretmanager.versions.access,secretmanager.versions.destroy \
  --stage GA

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member "serviceAccount:enat-api-staging@PROJECT_ID.iam.gserviceaccount.com" \
  --role "projects/PROJECT_ID/roles/enatRefreshTokenStore" \
  --condition='title=enat-refresh-tokens-only,description=Only gmail-refresh-token-* secrets plus project-level create,expression=resource.name.startsWith("projects/<num>/secrets/gmail-refresh-token-") || resource.name == "projects/<num>"'
```

What this deliberately leaves out: `secretmanager.secrets.get/list/delete/update` (the
service never enumerates or deletes secret containers — whole-user deletion in
`docs/privacy.md` is an operator action), `secretmanager.versions.enable/disable`, and
any access to secrets outside the prefix. The config secrets (`claude-api-key`,
`google-oauth-client-id`, `google-oauth-client-secret`) stay on their separate
per-secret `secretAccessor` bindings above and are not reachable through this role.

**3. Logging** needs no role. A custom runtime service account starts with no roles at all,
and none is needed for logs: Cloud Run itself collects the container's stdout and stderr
into Cloud Logging, independent of the service account's IAM. (Cloud Trace correlation is
done by a field in the log line, not by an API call.)

**Verify on staging once billing is restored.** The project-level `secrets.create` grant
with the prefix condition is the one binding here that is easy to get subtly wrong — the
condition's project clause, the project *number* versus *id* — and the only way to be sure
is the first real consent: run the Gmail consent flow for one account and confirm
`gcloud secrets list --filter="name:gmail-refresh-token-"` shows the new secret and the
service logged no `PERMISSION_DENIED`. Accepted trade-off: because `secrets.create` is
granted on the project, the service account can create a secret of *any* name; the
condition confines what it can then *do* with versions to the `gmail-refresh-token-`
prefix, which is the part that matters (a stray empty container is noise, not exposure).
