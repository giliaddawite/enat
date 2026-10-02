import type { ErrorRequestHandler } from 'express';
import { GmailApiError } from '../adapters/gmailApiClient.js';
import {
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
} from '../adapters/idTokenVerifier.js';
import { ConfigError } from '../config.js';
import { GmailNotConnectedError, GmailReconnectRequiredError } from '../domain/digestGeneration.js';
import {
  AuthCodeExchangeUnavailableError,
  GmailConsentRejectedError,
} from '../domain/gmailConsent.js';
import { VerseDatasetError } from '../domain/verse.js';
import type { LogFields, Logger } from '../logging/logger.js';
import type { ErrorResponse } from './apiSchemas.js';
import { HttpError, statusText, statusToCode } from './httpError.js';

/**
 * The error classes this repository defines. Their messages are written here, under the
 * rule that no message interpolates mail content or personal data, so they are safe to
 * log in full. An error of any other class — a Firestore or Secret Manager client error, a
 * gax or grpc failure, an SDK exception — is described by name and code only: upstream
 * libraries put their own inputs in `message` (a document path, a response body), and
 * `stack` begins with that message. Membership is by `instanceof`, never by name string,
 * so a foreign error cannot opt in by setting `name`.
 */
const OWN_ERROR_CLASSES: readonly (abstract new (...args: never[]) => Error)[] = [
  HttpError,
  ConfigError,
  GmailApiError,
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
  GmailNotConnectedError,
  GmailReconnectRequiredError,
  GmailConsentRejectedError,
  AuthCodeExchangeUnavailableError,
  VerseDatasetError,
];

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

    const body: ErrorResponse = {
      error: {
        code: clientError.code,
        message: clientError.message,
        requestId: req.requestId,
      },
    };
    res.status(clientError.status).json(body);
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
 * Only errors this service constructs (`OWN_ERROR_CLASSES`) are logged with their message
 * and stack. Every other Error is reduced to its name and, when present, its scalar `code`
 * (a gRPC status number, a Node `ECONNRESET`-style string) — enough to tell a Firestore
 * outage from a bug without copying whatever the library put in the message. Thrown values
 * that are not Errors are described by shape only: an arbitrary rejected value may hold
 * user data, and log entries must stay free of it.
 */
function describeError(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return { name: 'NonError', type: typeof error };
  }
  if (OWN_ERROR_CLASSES.some((errorClass) => error instanceof errorClass)) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  const code = scalarCode(error);
  return { name: error.name, ...(code !== undefined ? { code } : {}) };
}

function scalarCode(error: Error): string | number | undefined {
  const { code } = error as { code?: unknown };
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}
