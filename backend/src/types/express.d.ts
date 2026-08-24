import type { Logger } from '../logging/logger.js';

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
    }
  }
}
