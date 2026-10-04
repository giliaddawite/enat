import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
  type DigestGenerationService,
} from '../domain/digestGeneration.js';
import type { User } from '../domain/user.js';
import { DigestGenerationPushPayload, PubSubPushEnvelope } from '../http/apiSchemas.js';
import type { Logger } from '../logging/logger.js';

/**
 * The Cloud Scheduler → Pub/Sub push target (TICKET-105): Cloud Scheduler publishes
 * `{"uid": "<google-user-id>"}` to a topic every morning; Pub/Sub pushes it here as an
 * ordinary HTTPS POST. `verifyPubSubPush` (mounted ahead of this handler in `app.ts`) is the
 * auth; this handler only decides how to answer Pub/Sub's delivery, which is what its
 * retry policy reads: 2xx acks (never redeliver), a non-2xx asks for a retry with backoff.
 *
 * Never retried, always acked (2xx) — retrying cannot fix any of these:
 * - a push envelope or payload that fails validation (a subscription misconfiguration, not
 *   a transient fault) — including a body that is not JSON at all, which the body parser
 *   reports and `ackUnparseablePushBody` below turns into the same ack
 * - a uid naming no known user (a stale or hand-edited scheduler payload)
 * - a user who has not completed the Gmail consent flow (TICKET-202)
 * - a user whose Gmail grant was revoked (`invalid_grant`) — only re-running consent on the
 *   device fixes that, so redelivery would just burn quota until the message expires
 *
 * Retried (5xx, via the global error handler): anything else — a Gmail, Claude or Firestore
 * hiccup is exactly what Pub/Sub's backoff exists for.
 */
export interface DigestGenerationPushDependencies {
  readonly getUser: (uid: string) => Promise<User | null>;
  readonly generation: DigestGenerationService;
  readonly logger?: Logger;
}

export function createDigestGenerationPushHandler(
  deps: DigestGenerationPushDependencies,
): RequestHandler {
  return (req, res, next) => {
    void handle(req.body, res, deps).then(() => undefined, next);
  };
}

/**
 * Mounted between the body parser and the handler, after `verifyPubSubPush`. A verified
 * push whose body is not JSON is a misconfiguration retrying cannot fix, so it is acked
 * like every other invalid envelope instead of answered 400 — which Pub/Sub would retry
 * until the message expired. Only the parser's parse failure is caught; every other error
 * (an oversized body included) keeps its status.
 */
export function ackUnparseablePushBody(): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (!isBodyParseFailure(error)) {
      next(error);
      return;
    }
    // Request id only — the body is unparsed bytes from the wire and must not be logged.
    req.log?.warn('pubsub push body was not valid JSON; acked so Pub/Sub does not retry it');
    res.status(200).end();
  };
}

function isBodyParseFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

async function handle(
  body: unknown,
  res: Response,
  deps: DigestGenerationPushDependencies,
): Promise<void> {
  const uid = parseUid(body, deps.logger);
  if (uid === null) {
    res.status(200).end();
    return;
  }

  const user = await deps.getUser(uid);
  if (user === null) {
    deps.logger?.warn('digest generation push named an unknown user');
    res.status(200).end();
    return;
  }

  try {
    await deps.generation.generate(user);
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      deps.logger?.warn('digest generation push skipped: user has not connected Gmail');
      res.status(200).end();
      return;
    }
    if (error instanceof GmailReconnectRequiredError) {
      deps.logger?.warn('digest generation push skipped: Gmail grant revoked, reconnect required');
      res.status(200).end();
      return;
    }
    throw error;
  }
  res.status(204).end();
}

/** `null` means "not retryable" — the caller acks (200) instead of asking Pub/Sub to retry
 * a message that will never parse. */
function parseUid(body: unknown, logger: Logger | undefined): string | null {
  const envelope = PubSubPushEnvelope.safeParse(body);
  if (!envelope.success) {
    logger?.error('pubsub push envelope failed validation');
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(envelope.data.message.data, 'base64').toString('utf8'));
  } catch {
    logger?.error('pubsub push message data was not valid JSON');
    return null;
  }
  const parsedPayload = DigestGenerationPushPayload.safeParse(payload);
  if (!parsedPayload.success) {
    logger?.error('pubsub push message payload failed validation');
    return null;
  }
  return parsedPayload.data.uid;
}
