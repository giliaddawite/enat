import type { RequestHandler } from 'express';
import type { RateLimiter } from '../domain/rateLimiter.js';
import { HttpError } from './httpError.js';

export interface RateLimitDependencies {
  readonly rateLimiter: RateLimiter;
}

/**
 * Enforces the per-user request budget that protects the Claude API spend. Must be mounted
 * after `authenticate` — it keys on `req.user`, which only exists once a request has passed
 * through that middleware.
 */
export function rateLimit({ rateLimiter }: RateLimitDependencies): RequestHandler {
  return (req, res, next) => {
    if (req.user === undefined) {
      // A middleware-ordering bug, not a client error — fail loudly rather than silently
      // rate-limiting nothing.
      next(new Error('rateLimit middleware requires authenticate to run first'));
      return;
    }
    if (!rateLimiter.tryConsume(req.user.uid)) {
      req.log?.warn('rate limit exceeded');
      next(new HttpError(429));
      return;
    }
    next();
  };
}
