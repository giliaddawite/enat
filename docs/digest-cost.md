# Digest cost budget (TICKET-104)

Acceptance criterion: **cost per daily digest ≤ $0.05 at 50 emails/day.**

The pipeline does not hope to stay under budget — it enforces token caps that make the
worst case computable. This note is the arithmetic behind the constants in
`backend/src/domain/digestPipeline.ts`; if a cap or the model changes, redo this math in
the same change.

## Model choice

| Model (2026-08 pricing) | Input $/MTok | Output $/MTok | Worst-case digest\* | Fits budget? |
| ----------------------- | -----------: | ------------: | ------------------: | ------------ |
| claude-haiku-4-5        |        $1.00 |         $5.00 |              $0.043 | **yes**      |
| claude-sonnet-4-6       |        $3.00 |        $15.00 |              $0.129 | no           |
| claude-opus-5           |        $5.00 |        $25.00 |              $0.215 | no           |

\* At the caps below: 12,000 input + 6,200 output tokens.

A 50-email digest needs roughly 6,000+ output tokens (Amharic summaries; Ge'ez script
tokenizes at ~1 token per character), so on any Sonnet- or Opus-tier model the output
bill alone exceeds $0.05. **Haiku 4.5 is the only current model that fits the criterion**,
and it is more than adequate for constrained classification + two-sentence summarization.
The model is a constructor option on the Claude adapter (`DEFAULT_CLAUDE_MODEL`), so a
future upgrade is a configuration change plus a rerun of this math.

## Enforced caps → worst-case cost

Input (`MAX_INPUT_TOKENS_PER_DIGEST = 12_000`, enforced by `planDigestBatch`):

| Component                                        |       Tokens |
| ------------------------------------------------ | -----------: |
| Prompt overhead (system + instructions + date)   |          700 |
| Per email: envelope + From/Subject/Received      |          ~45 |
| Per email: body slice (`BODY_TOKENS_PER_EMAIL`)  |          180 |
| **50 emails: 700 + 50 × 225**                    |  **11,950**  |

Output (`OUTPUT_OVERHEAD_TOKENS + 50 × OUTPUT_TOKENS_PER_EMAIL = 200 + 6,000 = 6,200`,
enforced as the API `max_tokens`):

```
input   12,000 × $1.00 / 1M  = $0.0120
output   6,200 × $5.00 / 1M  = $0.0310
                       total = $0.0430  ≤ $0.05
```

The token estimator (`estimateTokens`) is deliberately conservative — 0.25 tokens per
ASCII character, 1 per non-ASCII code point — so the real Claude-side input count runs at
or below the planned figure. The golden test
(`digestPipeline.golden.test.ts` → "stays within the input-token cap") extrapolates the
measured fixture prompt to 50 emails and fails if it ever exceeds the cap.

## Why the typical day costs less

- **Caching:** results are cached in Firestore by message id; an email is summarized at
  most once, ever. Re-runs of a digest (idempotent scheduler retries, on-demand refresh)
  hit the cache and cost $0.
- **Real bodies are short:** 180 tokens is a per-email ceiling; snippets and short mails
  use far less, and unfetched bodies fall back to snippets.
- **Overflow degrades free:** emails beyond the input cap get category-only treatment
  from sender-domain heuristics — zero API tokens.

## Failure-path cost

A schema-invalid reply triggers exactly one retry (the original prompt plus ≤ 500 echoed
tokens), bounding a bad day at roughly 2× the worst case (~$0.09) — a rare event, not the
steady state, and there is never a third attempt: the pipeline falls back to free
heuristics. API errors (429/5xx) are retried by the SDK at the transport level before any
output tokens are billed.

## Verifying against reality

The Claude adapter logs `inputTokens` / `outputTokens` per batch call (counts only, never
content). After TICKET-105 wires the scheduled job, staging's structured logs give the
actual daily spend; if the logged input tokens ever approach 12,000 while emails overflow
to heuristics, revisit the per-email body slice before raising any cap.
