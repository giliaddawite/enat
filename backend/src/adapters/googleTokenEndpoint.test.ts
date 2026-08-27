import { describe, expect, it } from 'vitest';
import { readOAuthErrorCode } from './googleTokenEndpoint.js';

const errorResponse = (body: string): Response => new Response(body, { status: 400 });

describe('readOAuthErrorCode', () => {
  it('returns the RFC 6749 error code from a JSON error body', async () => {
    const code = await readOAuthErrorCode(
      errorResponse('{"error":"invalid_grant","error_description":"Bad Request"}'),
    );

    expect(code).toBe('invalid_grant');
  });

  it('returns undefined for a non-JSON body instead of throwing', async () => {
    await expect(readOAuthErrorCode(errorResponse('<html>nope</html>'))).resolves.toBeUndefined();
  });

  it('returns undefined when the error field is missing or not a string', async () => {
    await expect(
      readOAuthErrorCode(errorResponse('{"error_description":"x"}')),
    ).resolves.toBeUndefined();
    await expect(readOAuthErrorCode(errorResponse('{"error":42}'))).resolves.toBeUndefined();
    await expect(readOAuthErrorCode(errorResponse('"invalid_grant"'))).resolves.toBeUndefined();
  });

  it('refuses free-form text that does not match the error-code shape', async () => {
    const code = await readOAuthErrorCode(
      errorResponse('{"error":"Something Broke: token=ya29.SECRET"}'),
    );

    expect(code).toBeUndefined();
  });
});
