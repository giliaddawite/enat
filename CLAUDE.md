# Enat — Mom's Phone Companion

> Engineering standards for this repository. Claude Code reads this file automatically at the
> start of every session in this directory, so keep it accurate — stale instructions here cause
> stale work.

---

## Project overview

**What it is:** Enat is a companion app for one user — my mom. It fetches her Gmail inbox,
summarizes and categorizes emails **in Amharic** via the Claude API, serves a daily bilingual
scripture verse, and gives her a simplified, accessibility-first Android home hub. It serves one
user today but is architected to serve many.

**Stack:** Android app in **Kotlin + Jetpack Compose** (MVVM, Hilt, Retrofit/OkHttp,
coroutines + Flow, Room). Backend in **TypeScript on Node.js**, containerized on **Cloud Run**
(scale-to-zero), with **Firestore** for storage, **Gmail API** for ingestion, and the
**Claude API** for summarization/translation. CI/CD via GitHub Actions.
<!-- If the backend decision flips to Python: swap ESLint/Prettier → Ruff and update the
     commands table in the same commit. -->

**Status:** Greenfield. Work proceeds ticket-by-ticket from `docs/tickets/` — every change
must trace to a ticket, and a ticket's acceptance criteria are its definition of done.

**Guiding principles (from the project plan — treat as requirements, not aspirations):**
1. **Accessibility-first UI** — the user is an older adult reading Amharic.
2. **No secrets in the client** — tokens live server-side; the APK must contain no OAuth secrets.
3. **Offline-tolerant** — the app must be useful in airplane mode after one sync.
4. **Cheap to run** — scale-to-zero, aggressive caching, batched LLM calls. Budget:
   ≤ $0.05 per daily digest at 50 emails/day.
5. **Observable from day one** — structured logs, request IDs, cost dashboards.

---

## Commands

Run commands from the package directory (`/android` or `/backend`), not the repo root.

| Task | Backend (`/backend`) | Android (`/android`) |
| --- | --- | --- |
| Install dependencies | `npm ci` | Gradle sync (automatic) |
| Run locally | `npm run dev` | `./gradlew installDebug` |
| Run all tests | `npm test` | `./gradlew testDebugUnitTest` |
| Run a single test | `npm test -- <file>` | `./gradlew testDebugUnitTest --tests "<pattern>"` |
| Lint | `npm run lint` | `./gradlew ktlintCheck` |
| Format | `npm run format` | `./gradlew ktlintFormat` |
| Type check | `npm run typecheck` | (Kotlin compiler — `./gradlew compileDebugKotlin`) |
| Build for production | `npm run build` | `./gradlew bundleRelease` |
| UI tests | — | `./gradlew connectedDebugAndroidTest` |
| Secret scan | `gitleaks detect` (repo root) | same |

**Prefer the narrowest command that answers the question.** Run a single test file while
iterating; run the full suite once before declaring work done.

<!-- Keep this table in lockstep with TICKET-001's tooling setup. If a command here doesn't
     exist yet or was renamed, fixing this table is part of the ticket that changed it. -->

---

## Code style

- **Follow the surrounding code.** Match the naming, structure, and idiom of the file you're
  editing over any general preference stated here. Consistency inside a module beats global
  consistency.
- **Formatting is not a matter of opinion.** ktlint (Android) and Prettier (backend) decide.
  Never hand-format, and never reformat lines you aren't otherwise changing.
- **Names describe intent, not type or implementation.** `pendingDigest`, not `digestObj` or
  `data2`.
- **Comments explain _why_, not _what_.** Code that needs a comment to explain what it does
  usually needs a better name instead.
- **No dead code.** No commented-out blocks, unused imports, or `TODO(me)` breadcrumbs.
- **Prefer explicit over clever.** Optimize for the person debugging this at 2am.

**Kotlin/Compose specifics:**
- Composables are stateless where possible; state hoisted to ViewModels, exposed as `StateFlow`.
- Unidirectional data flow: UI emits events, ViewModel emits state. No business logic in
  composables.
- Every user-visible string goes through `strings.xml`, with the Amharic version in
  `values-am/` and English as fallback. **Never hardcode display text** — Amharic-first is a
  product requirement, not a translation pass at the end.

**TypeScript specifics:**
- `strict: true`; no `any` without an inline justification comment.
- Validate all external data (Gmail responses, Claude output, client requests) with a schema
  (zod) at the boundary. Interior code trusts its types.
- Config from environment variables, validated at boot — fail fast on missing config.

---

## Architecture and design

- **Small, honest units.** A function should do one thing at one level of abstraction.
- **Push side effects to the edges.** Gmail, Firestore, Claude API, and clock access live in
  thin adapter modules that can be substituted in tests. The digest pipeline's core logic
  (categorization rules, token budgeting, batching) is pure and unit-testable.
- **Dependencies flow inward.** Domain logic must not import transport, storage, or framework
  code. The reverse is fine.
- **Errors are values, not surprises.** Handle failure paths explicitly. Gmail 429/5xx get
  exponential backoff + jitter; Claude JSON parse failures get one schema-validated retry, then
  the heuristic fallback. Never swallow an exception silently.
- **No speculative abstraction.** One mom today. Three concrete uses justify an abstraction.
- **Reuse before you add.** Search for an existing helper before writing a new one.

**Enat-specific efficiency rules (these are acceptance criteria in the tickets):**
- **Gmail sync is incremental.** `historyId`-based sync after the first run; a second sync of
  an unchanged inbox makes ≤ 2 API calls. Batch `messages.get` with `format=metadata` first;
  fetch bodies only for messages that will be summarized. Stream/paginate — must handle 10k+
  message inboxes without OOM.
- **One LLM call per digest batch, never per email.** Structured JSON out, schema-validated.
  Cache results in Firestore by `messageId` — the same email is never summarized twice.
- **Cap input tokens per digest.** Overflow emails get category-only treatment via cheap
  heuristics (sender-domain lists).
- **The read path is cheap.** Digests are pre-generated on a schedule; `GET /v1/digest` is a
  Firestore fetch with ETag support, target < 300ms p95. Verse endpoint is edge-cached 24h.
- **Everything scales to zero.** No always-on processes, no polling loops on the backend.

**Android-specific rules:**
- **Offline-first.** Room caches the last digest and daily verse; every screen must render
  from cache with no network. Airplane-mode-after-one-sync is a test case, not an edge case.
- **API versioned under `/v1/`** from day one; the app never calls unversioned paths.

---

## Accessibility (non-negotiable on every UI ticket)

- Minimum touch target **64dp** (deliberately above the 48dp guideline).
- Minimum text size **20sp**, and every layout must survive the system font-size maximum
  without clipping — screenshot tests cover both extremes.
- **TalkBack:** content descriptions on every interactive element, logical focus order.
- **WCAG AA contrast**; no gesture-only interactions — everything reachable by tap.
- Every core action reachable in **≤ 2 taps** from launch.
- Accessibility Scanner must report **zero errors** before an Android ticket is done.
- Empty, loading, and error states are written in plain Amharic — never a spinner with no
  words, never an English-only error.

---

## Testing

- **Every behavior change ships with a test.** Bug fixes start with a failing test.
- **Test behavior, not implementation.** Assert on what a caller can observe.
- **Tests must be deterministic.** No real network, no real clock, no ordering dependence.
  Gmail and Claude are mocked/faked; inject time and randomness.
- **Golden-file tests for the LLM pipeline:** fixed email fixtures → assert category
  correctness. Prompt changes must update goldens deliberately, in the same commit.
- **One reason to fail per test.**
- **Never delete or skip a failing test to go green.**
- Coverage floors (TICKET-301): backend pipeline logic ≥ 80% unit coverage; contract tests for
  all `/v1/` schemas; Android ViewModel unit tests + Compose UI tests for hub and digest
  screens covering loading/success/empty/error.

---

## Git and review

- **Branch off `main`; never commit directly to it.** Branch names: `feat/`, `fix/`, `chore/`
  prefixes (see CONTRIBUTING.md). Include the ticket ID: `feat/ticket-103-gmail-sync`.
- **Conventional commits.** `feat(backend): add historyId-based incremental sync`, with a body
  explaining _why_ and a `Refs: TICKET-103` trailer.
- **One logical change per commit.** Refactoring and behavior change go in separate commits.
- **Pull requests stay small enough to actually review.** One ticket per PR unless tickets are
  trivially coupled.
- **Green before merge.** ktlint, ESLint, types, tests, and gitleaks all pass in CI. A failing
  test blocks merge — no exceptions, no "fix it after".

---

## Security and privacy

- **No secrets in the repository — ever.** Config via environment variables; committed
  `.env.example` has key names, no values. CI runs gitleaks on every PR.
- **No OAuth secrets in the APK.** The app uses the server auth-code flow; the backend
  exchanges for the refresh token. Verified by decompiling the release build (TICKET-202).
- **Refresh tokens are encrypted at rest** — Secret Manager or a KMS-encrypted Firestore
  field, never plaintext. Key rotation documented.
- **Least-privilege scopes only:** `gmail.readonly` + `gmail.modify`. Never request full mail
  scope.
- **Email bodies are never logged and never persisted server-side** beyond the request that
  processes them. Only summaries are cached. No PII in logs — log message IDs and counts, not
  content. This protects my mom's private mail; treat it as the hardest rule in this file.
- **Auth on every request:** Google ID token verified (signature, audience, expiry) against
  cached JWKS. 401s leak no detail. Per-user rate limiting (60 req/min) protects the Claude
  API budget.
- **Validate input at the trust boundary;** parameterized queries only; error responses never
  include stack traces.
- **Dependencies are a supply chain.** Dependabot enabled; add a dependency only when it earns
  its weight.

---

## Working agreements for Claude

- **Work from the ticket.** Before writing code, read the ticket in `docs/tickets/` and list
  its acceptance criteria. A ticket is done when every criterion demonstrably passes — not
  when the code compiles.
- **Read before you write.** Open the file and its neighbors before editing.
- **Ask when two readings of a request produce materially different work.** Make routine
  judgment calls without asking.
- **Report faithfully.** If tests fail, show the output. If a criterion was skipped or
  blocked, say so explicitly rather than reporting completion.
- **Stay in scope.** Fix the thing the ticket asks for. Note adjacent problems; file them as
  follow-up tickets rather than silently fixing them.
- **Don't run destructive or outward-facing commands without confirmation** — no force pushes,
  no history rewrites, no deploys, no `git push` unless asked. Never touch prod GCP resources;
  agents operate against staging/emulators only.
- **Amharic text changes get human review.** Claude may draft Amharic strings, but flag every
  new or changed Amharic string in the PR description for verification — the end user reads
  only the Amharic.
- **Keep this file current.** When a command, convention, or layout here stops being true,
  update it as part of the change that made it stale.

---

## Directory layout

```
enat/
├── .claude/              # Claude Code settings, agents, hooks, skills
├── android/              # Kotlin + Compose app (single module until it earns splitting)
├── backend/              # TypeScript Cloud Run service
│   └── src/
│       ├── domain/       # pure logic: digest pipeline, categorization, token budgeting
│       ├── adapters/     # gmail, firestore, claude, clock — all substitutable in tests
│       └── api/          # /v1/ routes, auth middleware, error handling
├── infra/                # GCP config, Cloud Scheduler, deployment manifests
├── docs/
│   ├── architecture.md   # system diagram: app → backend → Gmail API / Claude API
│   ├── privacy.md        # what data lives where (TICKET-303)
│   └── tickets/          # the ticket plan — source of truth for all work
├── CONTRIBUTING.md       # branch naming, conventional commits
└── CLAUDE.md             # this file
```