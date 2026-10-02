import { describe, expect, it } from 'vitest';
import { describeForeignError } from './foreignError.js';

const SECRET = 'refresh token ya29.secret-material';

describe('describeForeignError', () => {
  it('keeps only the name and a numeric code, never the message', () => {
    const error = Object.assign(new Error(`5 NOT_FOUND: ${SECRET}`), { code: 5 });

    const described = describeForeignError(error);

    expect(described).toEqual({ name: 'Error', code: 5 });
    expect(JSON.stringify(described)).not.toContain('secret');
  });

  it('keeps an identifier-shaped string code', () => {
    const error = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });

    expect(describeForeignError(error)).toEqual({ name: 'Error', code: 'ECONNRESET' });
  });

  it('replaces a prose-shaped name or string code with Unknown', () => {
    const error = Object.assign(new Error('boom'), { code: `status: ${SECRET}` });
    error.name = `Failure while storing ${SECRET}`;

    expect(describeForeignError(error)).toEqual({ name: 'Unknown', code: 'Unknown' });
  });

  it('replaces a non-scalar code with Unknown and omits an absent one', () => {
    expect(
      describeForeignError(Object.assign(new Error('x'), { code: { nested: SECRET } })),
    ).toEqual({ name: 'Error', code: 'Unknown' });
    expect(describeForeignError(new Error('x'))).toEqual({ name: 'Error' });
  });

  it('describes a thrown non-Error by shape only', () => {
    expect(describeForeignError(SECRET)).toEqual({ name: 'NonError', type: 'string' });
  });
});
