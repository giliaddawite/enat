import type { RequestHandler } from 'express';

/**
 * Liveness and startup probe target. Deliberately dependency-free: it answers "is this
 * container serving?", so it must not fail because a downstream service is degraded, and
 * it must stay cheap enough that probes cost nothing.
 */
export const healthz: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok' });
};
