import type { ErrorRequestHandler } from 'express';
import type { LogFields, Logger } from '../logging/logger.js';
import { HttpError, statusText, statusToCode } from './httpError.js';

interface ClientError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Terminal error handler. Clients get a status, a stable code and a generic message;
 * diagnostics (stack, original message) go to the log entry only.
 *
 * `fallbackLogger` is used when the failure happened before requestLogging bound `req.log`.
 */
export function errorHandler(fallbackLogger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      // The response is already streaming; Express's default handler destroys the socket,
      // which is the only correct move left.
      next(error);
      return;
    }

    const log = req.log ?? fallbackLogger.child({ requestId: req.requestId });
    const clientError = toClientError(error);

    if (clientError.status >= 500) {
      log.error('request failed', { status: clientError.status, error: describeError(error) });
    } else {
      log.warn('request rejected', { status: clientError.status, code: clientError.code });
    }

    res.status(clientError.status).json({
      error: {
        code: clientError.code,
        message: clientError.message,
        requestId: req.requestId,
      },
    });
  };
}

/**
 * Only a sub-500 HttpError may carry its own message outward; every other failure is
 * reduced to the generic status text so internal detail cannot leak by accident.
 */
function toClientError(error: unknown): ClientError {
  if (error instanceof HttpError && error.status < 500) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const status = clientFacingStatus(error);
  return { status, code: statusToCode(status), message: statusText(status) };
}

function clientFacingStatus(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status;
  }
  // Express and its body parsers signal client mistakes (bad URL encoding, malformed JSON)
  // with a 4xx `status` on an ordinary Error. Anything else is ours, and ours is a 500.
  const status = declaredStatus(error);
  return status !== undefined && status >= 400 && status <= 499 ? status : 500;
}

function declaredStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  if (Number.isInteger(status)) {
    return status as number;
  }
  return Number.isInteger(statusCode) ? (statusCode as number) : undefined;
}

/**
 * Thrown values that are not Errors are described by shape only: an arbitrary rejected
 * value may hold user data, and log entries must stay free of it. Error messages raised in
 * this service must likewise never interpolate email content or other personal data.
 */
function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'NonError', type: typeof error };
}
