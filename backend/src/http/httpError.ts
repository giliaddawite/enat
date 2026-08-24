import { STATUS_CODES } from 'node:http';

/**
 * An error whose status and message are safe to return to a client. Anything a caller
 * should not see (query results, upstream responses, stack traces) must not be put in
 * `message` — it is serialized into the response body verbatim for 4xx statuses.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message?: string, options?: ErrorOptions & { code?: string }) {
    super(message ?? statusText(status), options);
    this.name = 'HttpError';
    this.status = status;
    this.code = options?.code ?? statusToCode(status);
  }
}

export function statusText(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/** `404` -> `not_found`, so clients branch on a stable code rather than on prose. */
export function statusToCode(status: number): string {
  return statusText(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
