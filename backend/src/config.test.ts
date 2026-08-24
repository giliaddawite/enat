import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults suitable for local development when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      environment: 'development',
      logLevel: 'info',
      rateLimitPerMinute: 60,
    });
  });

  it('reads every supported variable from the environment', () => {
    expect(
      loadConfig({
        PORT: '3000',
        NODE_ENV: 'production',
        LOG_LEVEL: 'debug',
        GCP_PROJECT_ID: 'enat-staging',
        GOOGLE_OAUTH_AUDIENCE: 'android-client-id.apps.googleusercontent.com',
        RATE_LIMIT_PER_MINUTE: '30',
      }),
    ).toEqual({
      port: 3000,
      environment: 'production',
      logLevel: 'debug',
      gcpProjectId: 'enat-staging',
      googleOAuthAudience: ['android-client-id.apps.googleusercontent.com'],
      rateLimitPerMinute: 30,
    });
  });

  it('splits GOOGLE_OAUTH_AUDIENCE on commas to support rotating in a new client id', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      GCP_PROJECT_ID: 'enat-staging',
      GOOGLE_OAUTH_AUDIENCE: ' old-client-id , new-client-id ',
    });

    expect(config.googleOAuthAudience).toEqual(['old-client-id', 'new-client-id']);
  });

  it('requires GOOGLE_OAUTH_AUDIENCE in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', GCP_PROJECT_ID: 'enat-staging' }),
    ).toThrow(/GOOGLE_OAUTH_AUDIENCE is required when NODE_ENV=production/);
  });

  it('rejects a RATE_LIMIT_PER_MINUTE that is not a positive integer', () => {
    expect(() => loadConfig({ RATE_LIMIT_PER_MINUTE: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ RATE_LIMIT_PER_MINUTE: 'sixty' })).toThrow(ConfigError);
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
