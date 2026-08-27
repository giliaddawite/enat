import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  AuthCodeExchangeUnavailableError,
  GmailConsentRejectedError,
  type GmailConsentService,
} from '../domain/gmailConsent.js';
import { HttpError } from '../http/httpError.js';
import { requireUser } from '../http/requireUser.js';

/**
 * `POST /v1/auth/gmail-consent` (TICKET-202): the endpoint the Android setup flow hands
 * its one-time server auth code to. Thin by design — the exchange/verify/store decisions
 * live in `domain/gmailConsent.ts`; this handler only validates the body and maps the
 * service's typed errors to the stable codes the app branches on:
 *
 *   204                       consent stored; the app proceeds to the hub
 *   400 `bad_request`         body was not `{"authCode": "<non-empty string>"}`
 *   400 `invalid_grant`       Google refused the code — restart the flow for a fresh one
 *   400 `no_refresh_token`    no refresh token came back — re-prompt with forced consent
 *   400 `insufficient_scope`  a required Gmail scope was unchecked — re-prompt
 *   502 `bad_gateway`         Google's token endpoint failed — retry later, keep the code flow
 *
 * Mounted on the `v1` router in `app.ts`, so `authenticate` has already resolved `req.user`.
 */

const ConsentRequest = z.object({
  authCode: z.string().min(1),
});

export interface GmailConsentRouteDependencies {
  readonly consent: GmailConsentService;
}

export function connectGmail(deps: GmailConsentRouteDependencies): RequestHandler {
  return (req, res, next) => {
    void handle(req, res, deps).then(() => undefined, next);
  };
}

async function handle(
  req: Request,
  res: Response,
  deps: GmailConsentRouteDependencies,
): Promise<void> {
  const user = requireUser(req);

  const body = ConsentRequest.safeParse(req.body);
  if (!body.success) {
    // The zod issues are deliberately not forwarded: they would echo whatever the body
    // held, and this endpoint's bodies carry credentials.
    throw new HttpError(
      400,
      'Request body must be a JSON object with a non-empty "authCode" string.',
    );
  }

  try {
    await deps.consent.connect(user.uid, body.data.authCode);
  } catch (error) {
    if (error instanceof GmailConsentRejectedError) {
      throw new HttpError(400, error.message, { code: error.reason });
    }
    if (error instanceof AuthCodeExchangeUnavailableError) {
      // Logged here because the error handler only describes the HttpError it receives;
      // the message is status-and-shape only (see the adapter), never Google's body.
      req.log?.error('gmail consent exchange unavailable', {
        error: { name: error.name, message: error.message },
      });
      throw new HttpError(502);
    }
    throw error;
  }

  res.status(204).end();
}
