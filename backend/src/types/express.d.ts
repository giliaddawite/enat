import type { Logger } from '../logging/logger.js';
import type { User } from '../domain/user.js';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the requestId middleware. Optional because the global error handler can be
       * reached by an error raised before that middleware ran, and the error path must
       * never itself throw.
       */
      requestId?: string;
      /** Request-scoped logger set by the requestLogging middleware. See `requestId`. */
      log?: Logger;
      /** Set by the `authenticate` middleware once the Google ID token is verified. */
      user?: User;
    }
  }
}
