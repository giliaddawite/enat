import type { Request, RequestHandler } from 'express';
import type { LogFields, Logger } from '../logging/logger.js';
import { parseTraceId, traceResourceName } from './cloudTrace.js';

export interface RequestLoggingOptions {
  readonly logger: Logger;
  /** Enables Cloud Trace correlation. Absent outside production. */
  readonly projectId?: string;
  /** Monotonic milliseconds; injected so latency assertions can be deterministic. */
  readonly monotonicNow?: () => number;
}

/**
 * Binds a request-scoped logger to `req.log` and emits one access log entry per request.
 */
export function requestLogging(options: RequestLoggingOptions): RequestHandler {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());

  return (req, res, next) => {
    const startedAt = monotonicNow();
    // Captured now, while this middleware is still mounted at the root: a router that
    // dispatches into a sub-app rewrites req.url, and this runs again after the response.
    const path = loggablePath(req);
    req.log = options.logger.child(requestContext(req, options.projectId));

    // 'close' always fires, including when the client disconnects mid-response, so every
    // request produces exactly one entry. 'finish' would silently drop aborted requests.
    res.on('close', () => {
      const latencyMs = monotonicNow() - startedAt;
      const httpRequest = {
        requestMethod: req.method,
        requestUrl: path,
        status: res.statusCode,
        latency: formatLatency(latencyMs),
      };
      if (res.writableFinished) {
        logForStatus(req.log, res.statusCode)('request handled', { httpRequest });
      } else {
        req.log?.warn('request aborted by client', { httpRequest });
      }
    });

    next();
  };
}

function requestContext(req: Request, projectId: string | undefined): LogFields {
  const fields: LogFields = { requestId: req.requestId };
  const traceId = parseTraceId(req.get('X-Cloud-Trace-Context'));
  if (projectId !== undefined && traceId !== undefined) {
    fields['logging.googleapis.com/trace'] = traceResourceName(projectId, traceId);
  }
  return fields;
}

function logForStatus(logger: Logger | undefined, status: number) {
  if (logger === undefined) {
    return () => undefined;
  }
  if (status >= 500) {
    return logger.error.bind(logger);
  }
  if (status >= 400) {
    return logger.warn.bind(logger);
  }
  return logger.info.bind(logger);
}

const MAX_LOGGED_PATH_LENGTH = 256;

/**
 * The path only, never `originalUrl`. A request target may legally be sent in absolute
 * form (`GET http://user:password@host/path`), so `originalUrl` can carry an authority and
 * embedded credentials, and it keeps any `#fragment` the caller invented. Express has
 * already parsed those away in `req.path`, which also drops the query string — query
 * strings carry tokens and email addresses and must stay out of logs.
 *
 * The remainder is still caller-controlled and unbounded, so it is truncated.
 */
function loggablePath(req: Request): string {
  return req.path.slice(0, MAX_LOGGED_PATH_LENGTH);
}

/** Cloud Logging renders `httpRequest.latency` when it is a duration string. */
function formatLatency(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(3)}s`;
}
