# Backend runtime: scale-to-zero and cold start

Covers the TICKET-101 acceptance criteria that are properties of the deployed service
rather than of the code: scaling to zero when idle, and a documented p50 cold start under
two seconds.

## Scale to zero

`infra/cloudrun/service.staging.yaml` sets `autoscaling.knative.dev/minScale: '0'`. Cloud
Run keeps no idle instance, so an idle service bills nothing beyond image storage. Enat
serves one household; idle is its normal state, and a warm minimum instance would dominate
the bill.

Three supporting decisions:

- **At most one instance.** `autoscaling.knative.dev/maxScale: '1'` (TICKET-306). One
  household never needs a second instance, and the per-user rate limiter keeps its window
  in process memory, so a single instance is what makes the documented 60 req/min the
  enforced figure — see [`infra/README.md`](../infra/README.md) for what would have to
  change before raising it.
- **CPU is throttled outside requests.** `run.googleapis.com/cpu-throttling: 'true'` bills
  CPU only while a request is in flight. This matches the platform default and is pinned
  anyway, because it is the single setting that separates a near-zero bill from a real one:
  with CPU always allocated, an instance is billed for its whole lifetime rather than for
  its requests, which at a handful of wakes a day is the difference between cents and
  several dollars a month. Nothing in this service needs to run between requests, so
  background work must not be introduced without revisiting this.
- **SIGTERM is handled.** `src/index.ts` drains in-flight requests on SIGTERM and closes
  idle connections. Without it, reclaiming an idle instance would reset live connections,
  which turns scale-to-zero into visible client errors.

## Cold start

A cold start is the time from a request arriving at a service with zero running instances
to that request being served: image pull, container start, Node boot, first response.

### What the code and config do to keep it short

| Decision | Where | Effect |
| --- | --- | --- |
| `node:22-alpine` base, multi-stage build, `npm prune --omit=dev` | `backend/Dockerfile` | Small image; pull time is the largest and most variable term in a cold start |
| One runtime dependency (`express`) | `backend/package.json` | Less module resolution and parsing at boot |
| `startup-cpu-boost: 'true'` | `infra/cloudrun/service.staging.yaml` | Full CPU during startup, billed only for startup |
| `execution-environment: gen1` | `infra/cloudrun/service.staging.yaml` | Lower cold-start latency than gen2 (order of 0.5–1s on an image this size); no gen2 feature is needed. Pinned rather than left to the platform default |
| No liveness probe | `infra/cloudrun/service.staging.yaml` | Only the startup probe gates traffic; a liveness probe on a dependency-free endpoint buys nothing and can restart a container mid-request |
| No work at import time — config load and `listen` happen in `main()` | `backend/src/index.ts` | Nothing blocks the event loop before the port is open |
| `containerConcurrency: 80` | `infra/cloudrun/service.staging.yaml` | A single warm instance absorbs bursts instead of cold-starting more |
| Dependency-free `/healthz` | `backend/src/routes/health.ts` | The startup probe passes as soon as the port is open, rather than waiting on a downstream check |

### How to measure it

**Not yet measured.** Requires a deployed service, which is blocked on TICKET-003 (GCP
project) and TICKET-002 (deploy pipeline). Record the result in the table below when
staging is live; the criterion is not satisfied until a real number is in it.

1. Deploy to staging and leave the service idle for at least 15 minutes so every instance
   is reclaimed.
2. Authoritative source — Cloud Monitoring metric
   `run.googleapis.com/container/startup_latencies`, filtered to the staging service, read
   at the 50th percentile over the sample window. This measures container startup only.
3. Client-observed check — from a VM in the same region, alternating a request with a
   fifteen-minute idle period so each request hits a cold instance:

   ```sh
   curl -o /dev/null -s -w '%{time_total}\n' https://<service-url>/healthz
   ```

   Collect at least 20 samples. This includes TLS and network time, so it reads higher
   than the startup-latency metric; both are worth recording.

### Measurements

| Date | Revision | p50 startup latency | p50 cold request | Notes |
| --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | Blocked on TICKET-002 and TICKET-003 |

## Logging

Every request produces one structured JSON line on stdout, which Cloud Run forwards to
Cloud Logging. `severity`, `message` and `time` are promoted to log entry fields;
`httpRequest` renders as the request summary; `requestId` correlates the access log entry
with any error logged for the same request. When `GCP_PROJECT_ID` is set, the
`logging.googleapis.com/trace` field groups a request's entries under its trace.

Responses in the 5xx range are logged twice by design, both carrying the request id: once
by the error handler with a description of the error, and once by the access log with the
status and latency.

Log entries deliberately exclude query strings, request bodies, headers, and client IP
addresses. This service handles the contents of a personal mailbox; none of it belongs in
a log. The logged URL is Express's parsed `req.path`, truncated to 256 characters — never
`originalUrl`, which for a legal absolute-form request target
(`GET http://user:password@host/path`) carries an authority and embedded credentials.

What a log entry says about an error depends on who constructed it
(`src/http/describeError.ts`, `OWN_ERROR_CLASSES` — used by the error handler and by every
site that logs an error it caught itself, such as `auth.ts` and `routes/verse.ts`, so no
route can bypass the rule by reaching for `error.message`). An error of a class this repository
defines — `HttpError`, `GmailApiError`, `IdTokenRejectedError`, the digest-generation and
consent errors, and so on — is logged with its `message` and `stack`, because those
messages are written here under the rule that they never interpolate mail content or
personal data. Every other error — a Firestore or Secret Manager client error, a gax/grpc
failure, an SDK exception, or a bare `Error` — is logged as `{ name, code }` only, where
`code` is the scalar status the library attached (a gRPC status number, a Node
`ECONNRESET`-style string), and even those two are kept only when they look like
identifiers (`/^[A-Za-z0-9_.-]{1,64}$/`), otherwise `Unknown` — `src/logging/foreignError.ts`.
Those libraries put their own inputs in `message` — Firestore the document path, Google API
clients the upstream response body — and `stack` begins with `Name: message`, so neither
field is safe to copy. The allowlist is checked with
`instanceof`, never by comparing `name`, so a foreign error cannot opt in by naming itself
after one of ours. Adding an error class to this service means adding it to that list in
the same change, or its 5xx entries will carry no message.
