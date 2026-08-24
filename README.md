# Enat

[![PR](https://github.com/giliaddawite/enat/actions/workflows/pr.yml/badge.svg)](https://github.com/giliaddawite/enat/actions/workflows/pr.yml)
[![Deploy](https://github.com/giliaddawite/enat/actions/workflows/deploy.yml/badge.svg)](https://github.com/giliaddawite/enat/actions/workflows/deploy.yml)

An accessibility-first Android app that gives an Amharic-speaking parent a calm,
readable view of their day: an LLM-generated digest of their Gmail inbox in
Amharic, a daily verse, and one-tap family calling — all behind three oversized
buttons.

Two deliverables live in this repository:

- **`/android`** — Kotlin / Jetpack Compose app (MVVM, Hilt, Retrofit). Amharic
  primary, English fallback, tuned for large fonts and TalkBack.
- **`/backend`** — Node.js / TypeScript API on Cloud Run. Syncs Gmail
  incrementally, summarizes in batched Claude API calls, serves a pre-built
  daily digest and a daily verse.

Neither directory exists yet — the repo is at the bootstrap stage. The backend
skeleton lands with [TICKET-101](docs/tickets/TICKET-101) and the Android
scaffold with [TICKET-201](docs/tickets/TICKET-201). This README describes the
setup path those tickets build toward; steps marked **(soon)** activate as the
corresponding ticket merges.

See [docs/architecture.md](docs/architecture.md) for how the pieces fit
together, and [CONTRIBUTING.md](CONTRIBUTING.md) before pushing a branch.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 LTS (see `.nvmrc`) | backend |
| npm | 10+ | backend |
| JDK | 17+ | Android builds |
| Android Studio | latest stable | Android development |
| Git | 2.x | everything |
| gcloud CLI | latest | deploys, Firestore emulator, Gmail API setup |
| Docker | 20+ | backend container builds |

gcloud and Docker are only needed once you touch backend/cloud tickets; the
preflight script treats them as warnings, not failures.

## Setup — fresh clone to running dev environment

```bash
git clone <repo-url> fable-cooking
cd fable-cooking

# 1. Verify your machine has everything (fails loudly if not)
./scripts/preflight.sh

# 2. Create your local env file and fill in values — see the comments in
#    .env.example for what each key is and which ticket introduces it.
cp .env.example .env

# 3. Match the pinned Node version
nvm use   # reads .nvmrc
```

### Backend (soon — TICKET-101)

```bash
cd backend
npm ci                 # reproducible install from the lockfile
npm run dev            # starts the API on http://localhost:8080
curl localhost:8080/healthz
```

Local development runs against the Firestore emulator
(`FIRESTORE_EMULATOR_HOST` in `.env`); real GCP credentials are only needed for
staging/prod work:

```bash
gcloud auth application-default login
```

### Android (soon — TICKET-201)

Open `/android` in Android Studio, let Gradle sync, then run the `debug`
variant — it points at the staging backend. Or from the CLI:

```bash
cd android
./gradlew assembleDebug
```

## Everyday commands

Run these from the directory they belong to. All of them activate with
TICKET-101 (backend) / TICKET-201 (Android).

| Task | Command |
| --- | --- |
| Backend dev server | `npm run dev` |
| Backend tests | `npm test` |
| Backend lint | `npm run lint` |
| Backend type check | `npm run typecheck` |
| Android debug build | `./gradlew assembleDebug` |
| Android tests | `./gradlew testDebugUnitTest` |
| Android lint | `./gradlew ktlintCheck` |

CI runs lint + unit tests + build check on every PR into `main`; a failing
check blocks merge. Merging to `main` deploys the backend to Cloud Run staging
and builds a signed Android release AAB. See [docs/ci-cd.md](docs/ci-cd.md)
for the workflows and required secrets.

## Repository layout

```
fable-cooking/
├── .github/
│   └── workflows/    # PR checks + main-branch deploy (TICKET-002)
├── android/          # (soon) Compose app — TICKET-2xx
├── backend/          # (soon) Cloud Run API — TICKET-1xx
├── infra/            # (soon) deploy config & IaC
├── docs/
│   ├── architecture.md
│   ├── ci-cd.md
│   └── tickets/      # the full backlog, TICKET-001 … TICKET-304
├── scripts/
│   └── preflight.sh  # environment checker
├── CLAUDE.md         # engineering standards (read by Claude Code)
└── CONTRIBUTING.md   # branch naming, commits, review
```

## Security notes

- **No secrets in the repo, ever.** `.env` is gitignored; `.env.example` holds
  key names only. CI runs gitleaks.
- Gmail access uses the minimum scopes (`gmail.readonly` + `gmail.modify`), and
  refresh tokens are encrypted at rest server-side.
- Email bodies are never logged and never persisted beyond the request — only
  summaries are cached. See TICKET-303 for the full privacy posture.
