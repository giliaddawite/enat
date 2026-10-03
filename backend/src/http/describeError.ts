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
import { SingleFlightTimeoutError } from '../domain/singleFlight.js';
import { VerseDatasetError } from '../domain/verse.js';
import { describeForeignError } from '../logging/foreignError.js';
import type { LogFields } from '../logging/logger.js';
import { HttpError } from './httpError.js';

/**
 * The error classes this repository defines. Their messages are written here, under the
 * rule that no message interpolates mail content or personal data, so they are safe to
 * log in full. An error of any other class is handed to `describeForeignError`, which keeps
 * its name and code only. Membership is by `instanceof`, never by name string, so a foreign
 * error cannot opt in by setting `name`. Adding an error class to this service means adding
 * it here in the same change, or its log entries carry no message.
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
  SingleFlightTimeoutError,
];

/**
 * The one way an error is rendered into a log entry, used by the error handler and by
 * every site that logs an error it caught itself. One function, so the allowlist rule
 * cannot be bypassed by a route that reaches for `error.message` directly.
 */
export function describeError(error: unknown): LogFields {
  if (
    error instanceof Error &&
    OWN_ERROR_CLASSES.some((errorClass) => error instanceof errorClass)
  ) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return describeForeignError(error);
}
