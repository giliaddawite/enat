import { defineConfig } from 'vitest/config';

/**
 * Coverage (TICKET-301) is measured and gated over `src/domain/**` only — the pure pipeline
 * logic CLAUDE.md puts the ≥ 80% floor under. Adapters and HTTP code are exercised by their
 * own contract and integration tests but are not held to this number, so a thin adapter
 * cannot dilute or inflate the pipeline figure. The floor is enforced per file: the
 * directory-wide average sits far above 80%, and a single untested module hiding behind
 * that average is exactly what the floor exists to catch.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        perFile: true,
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
