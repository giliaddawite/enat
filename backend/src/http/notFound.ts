import type { RequestHandler } from 'express';
import { HttpError } from './httpError.js';

/** Converts an unmatched route into an error so every response leaves via errorHandler. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404));
};
