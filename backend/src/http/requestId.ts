import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER = 'X-Request-Id';

/**
 * Assigns every request a server-generated correlation id.
 *
 * An inbound X-Request-Id is deliberately ignored. A caller that chooses its own id can
 * pin every request to one value, or collide with another caller's, which is exactly the
 * thread you pull on when investigating abuse. Cross-service correlation is already served
 * by X-Cloud-Trace-Context, which is validated before use.
 */
export function requestId(generateId: () => string = randomUUID): RequestHandler {
  return (req, res, next) => {
    const id = generateId();
    req.requestId = id;
    res.setHeader(HEADER, id);
    next();
  };
}
