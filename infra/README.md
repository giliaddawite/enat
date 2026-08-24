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
  `europe-west1-docker.pkg.dev/<project>/enat/api@sha256:<digest>`.
- `PROJECT_ID_PLACEHOLDER` — the staging GCP project id. The `_PLACEHOLDER` suffix is
  load-bearing: a bare `PROJECT_ID` token would also match inside the `GCP_PROJECT_ID`
  env var name during global substitution.

## Deploying by hand

Requires the staging project and service account from TICKET-003. The automated path is
TICKET-002.

```sh
gcloud run services replace infra/cloudrun/service.staging.yaml --region europe-west1
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
