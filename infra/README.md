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

## Do not make this service public yet

This file grants no IAM. Until TICKET-102 lands its ID-token verification middleware, the
service has **no authentication of its own** and IAM is the only gate in front of it. Do
not grant `roles/run.invoker` to `allUsers` before then — every route, including the
unmatched-path handler, would be reachable unauthenticated and unrated.

`ingress: all` is correct and necessary for an Android client; it is IAM, not ingress,
that is holding the door here.

## Prerequisites not yet in place

- **TICKET-003** — GCP projects, service accounts, Artifact Registry repository.

The deploy workflow (TICKET-002, `.github/workflows/deploy.yml`) already builds, pushes,
substitutes the placeholders, and applies this file on every push to `main` — but until
TICKET-003 provisions the project and secrets, this configuration is unapplied and the
runtime acceptance criteria in TICKET-101 (scale to zero, cold-start latency) cannot be
measured. See [`docs/backend-runtime.md`](../docs/backend-runtime.md).

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
  so they do not go through YAML values: store them in Secret Manager and mount them with
  `gcloud run services update --set-secrets` — and note that until the mounts are added to
  `service.staging.yaml` as `secretKeyRef` entries (a follow-up that must wait for the
  secrets to exist, or every deploy would fail on the missing reference), each deploy
  drops them and the `--set-secrets` command must be re-run.

Until all five are set, the service still boots and serves reads of already-generated
digests; `/internal/digest-generate` (missing `PUBSUB_PUSH_AUDIENCE`/
`PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL`) is simply not mounted, and
`POST /v1/digest/generate` (missing the other three) answers a clear 500 rather than
crash-looping the service — see `backend/src/index.ts`.

**IAM is the real gate here, same as the warning above for the whole service.** Never grant
`roles/run.invoker` on this service to `allUsers`; `/internal/digest-generate` verifies the
pushed OIDC token as defense in depth, but the actual boundary is that only the
`enat-scheduler` service account may invoke the service at all.
