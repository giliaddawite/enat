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

See [docs/architecture.md](docs/architecture.md) for how the pieces fit
together, and [CONTRIBUTING.md](CONTRIBUTING.md) before pushing a branch.

Built with Claude Code as a pair programmer; [CLAUDE.md](CLAUDE.md) defines the
standards it works against, and [`.claude/agents`](.claude/agents) holds the
reviewer agents it runs. All code is reviewed through PRs.

## Status

Work proceeds ticket by ticket from [docs/tickets](docs/tickets); a ticket is
done when every acceptance criterion passes, not when the code compiles.

| Area | State |
| --- | --- |
| Repo scaffolding, CI/CD (TICKET-001, 002) | Done |
| Google Cloud environments (TICKET-003) | Staging provisioned; production project not yet created |
| Backend API — auth, Gmail sync, summarization, digest, verse (TICKET-101–106) | Done, plus hardening follow-ups (TICKET-303, 305, 306) |
| Android app — scaffold, sign-in + consent, home hub, digest, verse + reminder (TICKET-201–205) | Done |
| Launcher / simplification mode (TICKET-206, stretch) | Not started |
| Testing baseline, security & privacy review (TICKET-301, 303) | Done |
| Observability & cost monitoring (TICKET-302) | Partial — structured logs, request IDs and Cloud Trace correlation are in; dashboards and alerts are not |
| Field test with mom (TICKET-304) | Not started |

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
git clone https://github.com/giliaddawite/enat.git
cd enat

# 1. Verify your machine has everything (fails loudly if not)
./scripts/preflight.sh

# 2. Create your local env file and fill in values — see the comments in
#    .env.example for what each key is and which ticket introduces it.
cp .env.example .env

# 3. Match the pinned Node version
nvm use   # reads .nvmrc
```

### Backend

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

### Android

Open `/android` in Android Studio, let Gradle sync, then run the `debug`
variant — it points at the staging backend. The staging URL and the web OAuth
client id are configuration, not secrets, but they stay out of version control:
put `enatApiBaseUrl` and `enatGoogleWebClientId` in `android/local.properties`
(gitignored). A fresh checkout compiles without them and shows a configuration
error on the setup screen. Or from the CLI:

```bash
cd android
./gradlew assembleDebug
```

## Everyday commands

Run these from the directory they belong to. CLAUDE.md has the full table,
including how to re-record screenshot goldens.

| Task | Command |
| --- | --- |
| Backend dev server | `npm run dev` |
| Backend tests | `npm test` |
| Backend tests with the CI coverage gate | `npm run test:coverage` |
| Backend lint | `npm run lint` |
| Backend format check | `npm run format:check` |
| Backend type check | `npm run typecheck` |
| Android debug build | `./gradlew assembleDebug` |
| Android tests | `./gradlew testDebugUnitTest` |
| Android tests with the screenshot gate | `./gradlew testDebugUnitTest verifyRoborazziDebug` |
| Android lint | `./gradlew ktlintCheck` |

CI runs lint, format, type and unit-test checks plus a secrets scan on every PR
into `main`; a failing check blocks merge. Merging to `main` deploys the backend
to Cloud Run staging and builds a signed Android release AAB. See
[docs/ci-cd.md](docs/ci-cd.md) for the workflows and required secrets.

## Repository layout

```
enat/
├── .claude/
│   └── agents/           # reviewer and implementer agents for Claude Code
├── .github/
│   └── workflows/        # PR checks + main-branch deploy (TICKET-002)
├── android/              # Compose app — TICKET-2xx
├── backend/              # Cloud Run API — TICKET-1xx
├── infra/                # Cloud Run service manifest, IAM and deploy notes
├── docs/
│   ├── architecture.md
│   ├── backend-runtime.md
│   ├── ci-cd.md
│   ├── digest-cost.md
│   ├── privacy.md
│   ├── verse-licensing.md
│   └── tickets/          # the full backlog, TICKET-001 … TICKET-306
├── scripts/
│   └── preflight.sh      # environment checker
├── CLAUDE.md             # engineering standards (read by Claude Code)
└── CONTRIBUTING.md       # branch naming, commits, review
```

## Security notes

- **No secrets in the repo, ever.** `.env` is gitignored; `.env.example` holds
  key names only. CI runs gitleaks.
- Gmail access uses the minimum scopes (`gmail.readonly` + `gmail.modify`), and
  refresh tokens are encrypted at rest server-side.
- Email bodies are never logged and never persisted beyond the request — only
  summaries are cached, and they expire. `docs/privacy.md` is the full
  inventory: every store, its fields, retention and deletion path.
