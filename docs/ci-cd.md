# CI/CD pipeline

Implements TICKET-002. Two GitHub Actions workflows plus one reusable one:

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/pr.yml` | pull request → `main` | lint, unit tests, build check |
| `.github/workflows/deploy.yml` | push to `main` | deploy backend to Cloud Run staging, build signed Android AAB |
| `.github/workflows/secrets-scan.yml` | called by both above | gitleaks scan, shared so the two entry points can't drift |

## Why the jobs are guarded

`/backend` and `/android` don't exist yet — they land with TICKET-101 and
TICKET-201. Each workflow starts with a `detect` job that checks for
`backend/package.json` and `android/settings.gradle.kts`; the backend/android
jobs run only when the corresponding directory is present. Until then, PRs and
merges to `main` still run the gitleaks scan and pass cleanly — the pipeline
doesn't block on tickets it doesn't depend on. No workflow file needs to
change when TICKET-101/201 merge; the jobs just start running.

## The one required status check

Branch protection should require a single check: **`pr-required-checks`**
(from `pr.yml`). That job fails if the secrets scan fails or if a
now-active backend/android job fails, and passes if a not-yet-active job was
skipped. Pointing branch protection at this one name — rather than at
`backend` and `android` individually — means the required-checks list never
needs to be edited as tickets land.

**Manual step, not done by this change:** turning that requirement on is a
repository setting (Settings → Branches → branch protection rule for `main`
→ "Require status checks to pass" → `pr-required-checks`). That's an
outward-facing GitHub configuration change, not a file in this repo, so it's
left for you to enable directly.

## Required GitHub secrets

None of these have values in this repository — set them under
**Settings → Secrets and variables → Actions**, scoped to the `staging`
environment where noted. TICKET-003 is what actually provisions the GCP
project, service accounts, and IAM roles these secrets point at.

| Secret | Used by | Notes |
| --- | --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | deploy-backend | Workload Identity Federation provider resource name — no long-lived service-account key is stored anywhere |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | deploy-backend | staging deploy service account email, minimal IAM (TICKET-003) |
| `GCP_PROJECT_ID` | deploy-backend | staging GCP project ID |
| `GCP_REGION` | deploy-backend | `us-central1` — must match the region conventions in `infra/` |
| `ARTIFACT_REGISTRY_REPO` | deploy-backend | Artifact Registry repository name |
| `ANDROID_KEYSTORE_BASE64` | build-android-release | release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | build-android-release | |
| `ANDROID_KEY_ALIAS` | build-android-release | |
| `ANDROID_KEY_PASSWORD` | build-android-release | |
| `GITLEAKS_LICENSE` | secrets-scan | optional; only needed if gitleaks starts rate-limiting the free tier |

We use Workload Identity Federation instead of a downloaded service-account
JSON key specifically so no GCP credential file ever needs to exist as a
GitHub secret — reducing what "never appears in the repo" has to cover.

There is no service-name secret: the deploy job renders
`infra/cloudrun/service.staging.yaml` (substituting the digest-pinned image
and the project id for its placeholders) and applies it with
`gcloud run services replace`. That file — not workflow flags — is the source
of truth for the service name, env vars, scaling limits, and cost-control
annotations; see `infra/README.md`.

## Verifying "no credentials in tracked files"

The `secrets-scan` job runs `gitleaks/gitleaks-action` against full git
history on every PR and every push to `main`. It fails the build (and, once
branch protection is enabled, blocks merge) if it finds anything that looks
like a credential in a tracked file.
