# fable-cooking

> Engineering standards for this repository. Claude Code reads this file automatically at the
> start of every session in this directory, so keep it accurate — stale instructions here cause
> stale work.

---

## Project overview

**What it is:** Enat — an accessibility-first Android app for an Amharic-speaking parent: an
LLM-generated Amharic digest of their Gmail inbox, a daily verse, and one-tap family calling.
Built and operated by one developer for one primary user. See `docs/architecture.md`.

**Stack:** Android app in Kotlin/Jetpack Compose (MVVM, Hilt, Retrofit); backend in
Node.js 22/TypeScript on Cloud Run with npm; Firestore for data; Gmail API and Claude API as
the external services.

**Status:** Bootstrap — docs, shared config, and the ticket backlog (`docs/tickets/`) exist;
`/backend` lands with TICKET-101 and `/android` with TICKET-201.

---

## Commands

The only command that works today is `./scripts/preflight.sh` from the repo root — `/backend`
and `/android` don't exist yet, so nothing below it runs until TICKET-101 / TICKET-201 create
them. The rest of this table documents the commands those tickets are expected to wire up, run
from inside each directory; update it to match reality as part of whichever ticket adds each
script.

| Task | Command | Directory |
| --- | --- | --- |
| Check local environment | `./scripts/preflight.sh` | repo root |
| Install dependencies | `npm install` | `backend/` |
| Run the backend locally | `npm run dev` | `backend/` |
| Run all backend tests | `npm test` | `backend/` |
| Run a single backend test | `npm test -- <path-or-pattern>` | `backend/` |
| Backend lint | `npm run lint` | `backend/` |
| Backend type check | `npm run typecheck` | `backend/` |
| Android debug build | `./gradlew assembleDebug` | `android/` |
| Android tests | `./gradlew test` | `android/` |
| Android lint | `./gradlew ktlintCheck` | `android/` |

**Prefer the narrowest command that answers the question.** Run a single test file while
iterating; run the full suite once before declaring work done.

---

## Code style

- **Follow the surrounding code.** Match the naming, structure, and idiom of the file you're
  editing over any general preference stated here. Consistency inside a module beats global
  consistency.
- **Formatting is not a matter of opinion.** The formatter decides. Never hand-format, and never
  reformat lines you aren't otherwise changing — it buries the real diff.
- **Names describe intent, not type or implementation.** `pendingOrders`, not `orderArr` or
  `data2`.
- **Comments explain _why_, not _what_.** Code that needs a comment to explain what it does
  usually needs a better name instead. Comments that restate the line get deleted.
- **No dead code.** Don't leave commented-out blocks, unused imports, or `TODO(me)` breadcrumbs.
  Version control is the archive.
- **Prefer explicit over clever.** Optimize for the person debugging this at 2am, who is probably
  you.

---

## Architecture and design

- **Small, honest units.** A function should do one thing at one level of abstraction. If you
  can't name it without "and", split it.
- **Push side effects to the edges.** Keep business logic pure and testable; do I/O, network, and
  clock access at the boundary where it can be substituted in tests.
- **Dependencies flow inward.** Domain logic must not import transport, storage, or framework
  code. The reverse is fine.
- **Errors are values, not surprises.** Handle the failure path explicitly at the boundary. Never
  swallow an exception into an empty catch; if you genuinely intend to ignore it, say why in a
  comment.
- **No speculative abstraction.** Build the thing that's needed now. Three concrete uses justify
  an abstraction; one hypothetical use does not.
- **Reuse before you add.** Search for an existing helper before writing a new one. Duplicated
  logic is a bug waiting to be half-fixed.

---

## Testing

- **Every behavior change ships with a test.** Bug fixes start with a failing test that reproduces
  the bug; if you can't write that test, you don't yet understand the bug.
- **Test behavior, not implementation.** Assert on what a caller can observe. Tests that assert on
  internal call order break on every refactor and protect nothing.
- **Tests must be deterministic.** No real network, no real clock, no ordering dependence between
  tests, no sleeps. Inject time and randomness.
- **One reason to fail per test.** A test name should read as the sentence that's false when it
  breaks.
- **Never delete or skip a failing test to go green.** Fix the code or fix the test's premise, and
  say which you did.

---

## Git and review

- **Branch off `main`; never commit directly to it.**
- **One logical change per commit.** Refactoring and behavior change go in separate commits — a
  reviewer can verify either one alone, and neither together.
- **Commit messages:** imperative subject under ~72 characters, then a body explaining _why_ the
  change was needed. The diff already shows what changed.

  ```
  Cache recipe lookups by slug

  The recipe page issued one query per ingredient, which made the p95
  load time scale with recipe size. Caching by slug collapses this to a
  single query per render.
  ```

- **Pull requests stay small enough to actually review.** If a PR needs a table of contents, split
  it.
- **Green before merge.** Lint, types, and tests all pass in CI. Don't merge on a promise to fix
  it after.

---

## Security

- **No secrets in the repository — ever.** Config comes from environment variables. Keep a
  committed `.env.example` with the key names and no values.
- **Validate input at the trust boundary,** and treat everything from a client, a third-party API,
  or a file on disk as untrusted.
- **Parameterized queries only.** No string-concatenated SQL, shell commands, or file paths built
  from user input.
- **Don't log secrets or personal data.** Tokens, passwords, and full request bodies stay out of
  logs.
- **Dependencies are a supply chain.** Add one only when it earns its weight, and prefer the
  well-maintained option over the clever one.

---

## Working agreements for Claude

- **Read before you write.** Open the file and its neighbors before editing; don't infer structure
  from a filename.
- **Ask when two readings of a request produce materially different work.** Make routine judgment
  calls without asking.
- **Report faithfully.** If tests fail, show the output. If part of a task was skipped or blocked,
  say so explicitly rather than reporting completion.
- **Stay in scope.** Fix the thing that was asked. Note adjacent problems you notice; don't
  silently fix them in the same change.
- **Don't run destructive or outward-facing commands without confirmation** — no force pushes, no
  history rewrites, no deploys, no `git push` unless asked.
- **Keep this file current.** When a command, convention, or layout here stops being true, update
  it as part of the change that made it stale.

---

## Directory layout

```
fable-cooking/
├── .claude/          # Claude Code settings, agents, and skills
├── .github/
│   └── workflows/    # PR checks + main-branch deploy (TICKET-002)
├── android/          # (TICKET-201) Compose app
├── backend/          # (TICKET-101) Cloud Run API
├── infra/            # (TICKET-003) deploy config & IaC
├── docs/
│   ├── architecture.md   # system design: app → backend → Gmail/Claude
│   ├── ci-cd.md          # CI/CD workflows and required secrets
│   └── tickets/          # backlog, TICKET-001 … TICKET-304
├── scripts/
│   └── preflight.sh  # fresh-clone environment checker
├── CLAUDE.md         # this file
├── CONTRIBUTING.md   # branch naming, conventional commits, review
└── README.md         # local setup path
```
