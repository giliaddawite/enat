import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults suitable for local development when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      environment: 'development',
      logLevel: 'info',
    });
  });

  it('reads every supported variable from the environment', () => {
    expect(
      loadConfig({
        PORT: '3000',
        NODE_ENV: 'production',
        LOG_LEVEL: 'debug',
        GCP_PROJECT_ID: 'enat-staging',
      }),
    ).toEqual({
      port: 3000,
      environment: 'production',
      logLevel: 'debug',
      gcpProjectId: 'enat-staging',
    });
  });

  it('rejects a PORT that is not a valid TCP port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError);
  });

  it('rejects a PORT that is not a number', () => {
    expect(() => loadConfig({ PORT: 'eight-thousand' })).toThrow(ConfigError);
  });

  it('rejects numeric forms that are not plain integers', () => {
    expect(() => loadConfig({ PORT: '0x1F50' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '8e3' })).toThrow(ConfigError);
  });

  it('never echoes the offending value, which may be a secret', () => {
    try {
      loadConfig({ PORT: 'sk-live-not-actually-a-port', LOG_LEVEL: 'sk-live-also-secret' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      expect((error as ConfigError).message).not.toContain('sk-live');
    }
  });

  it('rejects a malformed GCP_PROJECT_ID before it reaches a log resource name', () => {
    expect(() => loadConfig({ GCP_PROJECT_ID: 'Not/A/Project' })).toThrow(ConfigError);
    expect(() => loadConfig({ GCP_PROJECT_ID: 'ends-with-hyphen-' })).toThrow(ConfigError);
    expect(() => loadConfig({ GCP_PROJECT_ID: 'short' })).toThrow(ConfigError);
  });

  it('accepts a well-formed GCP_PROJECT_ID', () => {
    expect(loadConfig({ GCP_PROJECT_ID: 'enat-staging-01' }).gcpProjectId).toBe('enat-staging-01');
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });

  it('requires GCP_PROJECT_ID in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /GCP_PROJECT_ID is required when NODE_ENV=production/,
    );
  });

  it('treats a blank GCP_PROJECT_ID in production as missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', GCP_PROJECT_ID: '   ' })).toThrow(
      ConfigError,
    );
  });

  it('reports every problem at once so a bad deploy is fixed in one pass', () => {
    try {
      loadConfig({ PORT: '0', NODE_ENV: 'staging', LOG_LEVEL: 'loud' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(3);
    }
  });
});
