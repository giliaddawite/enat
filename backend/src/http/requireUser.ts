import type { Request } from 'express';
import type { User } from '../domain/user.js';
import { HttpError } from './httpError.js';

/**
 * The authenticated user `authenticate` attached to the request. Unreachable in practice
 * for any route mounted on the `v1` router (see app.ts) — guarded rather than asserted so
 * a future mounting mistake fails loudly as a 401, not a crash.
 */
export function requireUser(req: Request): User {
  if (req.user === undefined) {
    throw new HttpError(401);
  }
  return req.user;
}
