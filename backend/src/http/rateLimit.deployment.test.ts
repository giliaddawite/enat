import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deployment half of the rate-limit contract (TICKET-306). `createRateLimiter` keeps
 * its window in process memory, so the per-user budget `rateLimit` enforces is only the
 * documented 60 req/min while the service runs exactly one instance. That is pinned in the
 * Cloud Run manifest rather than in code, so this test reads the manifest: raising
 * `maxScale` without first moving the window to a shared store fails here, and the failure
 * names the trade-off (see infra/README.md) instead of silently multiplying the budget.
 *
 * A string match, not a YAML parser, on purpose: the value is one annotation line, and a
 * YAML dependency would be a supply-chain addition carried for a single assertion.
 */
const MANIFEST_DIR = join(import.meta.dirname, '..', '..', '..', 'infra', 'cloudrun');
const SERVICE_MANIFEST = /^service\..+\.ya?ml$/;
const MAX_SCALE_LINE = /^\s*autoscaling\.knative\.dev\/maxScale:\s*(\S+)\s*$/gm;

function serviceManifests(): string[] {
  return readdirSync(MANIFEST_DIR).filter((name) => SERVICE_MANIFEST.test(name));
}

describe('the per-process rate limiter deployment contract', () => {
  it('finds at least one Cloud Run service manifest to check', () => {
    expect(serviceManifests().length).toBeGreaterThan(0);
  });

  it.each(serviceManifests())('%s runs exactly one instance (maxScale is 1)', (name) => {
    const manifest = readFileSync(join(MANIFEST_DIR, name), 'utf8');

    const maxScaleValues = [...manifest.matchAll(MAX_SCALE_LINE)].map((match) => match[1]);

    expect(maxScaleValues).toEqual(["'1'"]);
  });
});
