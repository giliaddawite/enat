import type { LogFields } from './logger.js';

/**
 * Describes an error this service did not construct — a Firestore, Secret Manager, gax,
 * grpc or SDK failure — in a form that is safe to log. Only the class name and a scalar
 * status code are kept: upstream libraries put their own inputs in `message` (a document
 * path, a response body, a resource name embedding the uid), and `stack` begins with that
 * message. Even `name` and a string `code` are only trusted when they look like an
 * identifier: a library that puts prose in either field gets `Unknown` instead.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
const UNKNOWN = 'Unknown';

export function describeForeignError(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    // Described by shape only: an arbitrary rejected value may hold user data.
    return { name: 'NonError', type: typeof error };
  }
  const code = scalarCode(error);
  return { name: safeToken(error.name), ...(code !== undefined ? { code } : {}) };
}

/** A gRPC status number stays a number; a Node `ECONNRESET`-style string must look like one. */
function scalarCode(error: Error): string | number | undefined {
  const { code } = error as { code?: unknown };
  if (code === undefined) {
    return undefined;
  }
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code;
  }
  return typeof code === 'string' ? safeToken(code) : UNKNOWN;
}

function safeToken(value: string): string {
  return SAFE_TOKEN.test(value) ? value : UNKNOWN;
}
