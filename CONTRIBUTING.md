# Contributing

Ground rules for working in this repository. CLAUDE.md holds the full
engineering standards; this file covers the mechanics of branches, commits, and
review.

## Branches

Never commit directly to `main` — all work goes through a branch and a PR.

Name branches `<type>/<ticket>-<short-description>`:

```
feat/ticket-103-gmail-incremental-sync
fix/ticket-204-digest-empty-state
chore/ticket-002-ci-pipeline
docs/ticket-001-architecture
```

- **type** — one of the commit types below (`feat`, `fix`, `chore`, `docs`,
  `refactor`, `test`, `ci`).
- **ticket** — the ticket the branch serves, lowercase (`ticket-103`). Rare
  untracked work may omit it, but if the work is worth a branch it is usually
  worth a ticket.
- **short-description** — a few kebab-case words; the ticket has the details.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative subject, ≤72 chars>

<body: why the change was needed — the diff already shows what>

Refs: TICKET-XXX
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`.
Scopes, when useful, are the top-level area: `backend`, `android`, `infra`,
`docs`.

Example:

```
perf(backend): cache summaries by messageId

Each digest run re-summarized every email in the window, so a 50-email
inbox cost 50x what it should. Keying the cache by messageId means an
email is summarized exactly once for its lifetime.

Refs: TICKET-104
```

Rules that get PRs bounced:

- **One logical change per commit.** Refactoring and behavior change are
  separate commits — a reviewer can verify either alone, neither together.
- **Reference the ticket** with a `Refs: TICKET-XXX` trailer.
- **Subject is imperative** ("add", not "added" or "adds") and under ~72
  characters.

## Pull requests

- Small enough to actually review. If a PR needs a table of contents, split it.
- Every behavior change ships with a test. Bug fixes start with a failing test
  that reproduces the bug.
- Green before merge: lint, types, and tests all pass in CI (TICKET-002). A
  failing test blocks merge — never delete or skip one to get there.
- Note tradeoffs and follow-ups in the PR description; file tickets for
  adjacent problems instead of fixing them silently in the same change.

## Security checklist (every PR)

- No secrets in any tracked file — config comes from environment variables,
  key names live in `.env.example`.
- Input from clients, Gmail, or the LLM is validated at the trust boundary.
- No email bodies or PII in logs, even in debug code.
