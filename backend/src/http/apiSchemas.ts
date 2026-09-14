import { z } from 'zod';
import type { Digest } from '../domain/digest.js';
import { EMAIL_CATEGORIES } from '../domain/summary.js';
import type { DailyVerse } from '../domain/verse.js';

/**
 * The wire contract (TICKET-301): every body this service accepts or sends, as zod
 * schemas. Routes import their request schemas from here to validate input at the trust
 * boundary and type their responses with the inferred types; the contract tests
 * (`routes/contracts.test.ts`) parse real HTTP responses against the same objects. One
 * module, so a route and its test cannot drift apart silently.
 *
 * Response schemas are annotated with the domain type they serialize, so the compiler
 * rejects a schema that omits a field the domain type carries. They are `strictObject`s,
 * so the contract tests reject a response carrying a field the schema does not name — the
 * pipeline-internal `source`/`promptVersion` on a summary, or the dataset's review-only
 * `verified` flag on a verse, must never reach the app.
 */

/** The envelope every non-2xx response carries (see `errorHandler`). `requestId` is absent
 * only when the failure happened before the requestId middleware ran. */
export const ErrorResponse = z.strictObject({
  error: z.strictObject({
    /** A stable snake_case identifier clients branch on — never prose. */
    code: z.string().regex(/^[a-z0-9_]+$/),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** `GET /healthz`. */
export const HealthResponse = z.strictObject({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;

const DigestEmailItem = z.strictObject({
  messageId: z.string().min(1),
  from: z.string(),
  subject: z.string(),
  summary: z.string().nullable(),
  urgent: z.boolean(),
  receivedAt: z.iso.datetime(),
});

const DigestSection = z.strictObject({
  category: z.enum(EMAIL_CATEGORIES),
  items: z.array(DigestEmailItem),
});

/** `GET /v1/digest` and `POST /v1/digest/generate`: the stored digest document verbatim. */
export const DigestResponse: z.ZodType<Digest> = z.strictObject({
  date: z.iso.date(),
  userId: z.string().min(1),
  sections: z.array(DigestSection),
  generatedAt: z.iso.datetime(),
  emailCount: z.number().int().nonnegative(),
});
export type DigestResponse = Digest;

/** `GET /v1/verse/today`: public-domain scripture, identical for every caller, so nothing
 * per-user may ever be added here (the response is stored by shared caches). */
export const VerseResponse: z.ZodType<DailyVerse> = z.strictObject({
  date: z.iso.date(),
  reference: z.string().min(1),
  referenceAm: z.string().min(1),
  textEn: z.string().min(1),
  textAm: z.string().min(1),
});
export type VerseResponse = DailyVerse;

/** `POST /v1/auth/gmail-consent` body: the one-time server auth code from the device. */
export const GmailConsentRequest = z.object({
  authCode: z.string().min(1),
});

/** `POST /internal/digest-generate` body: the Pub/Sub push envelope, whose `message.data`
 * carries the scheduler payload base64-encoded. */
export const PubSubPushEnvelope = z.object({
  message: z.object({
    data: z.string().min(1),
  }),
});

/** The decoded `message.data` of a digest generation push. */
export const DigestGenerationPushPayload = z.object({
  uid: z.string().min(1),
});
