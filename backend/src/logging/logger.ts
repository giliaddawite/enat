export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Cloud Logging severity names. https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every entry, for request-scoped context. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Defaults to stdout, which Cloud Run scrapes into Cloud Logging. */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
  readonly baseFields?: LogFields;
}

const SEVERITIES: Record<LogLevel, Severity> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

const THRESHOLDS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const now = options.now ?? (() => new Date());
  const baseFields = options.baseFields ?? {};
  const threshold = THRESHOLDS[options.level];

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (THRESHOLDS[level] < threshold) {
      return;
    }
    write(serialize({ ...baseFields, ...fields }, SEVERITIES[level], message, now()));
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, baseFields: { ...baseFields, ...fields } }),
  };
}

/**
 * `severity`, `message` and `time` are the keys Cloud Logging promotes out of a JSON line
 * on stdout; everything else stays in jsonPayload.
 */
function serialize(fields: LogFields, severity: Severity, message: string, time: Date): string {
  const entry = { ...fields, severity, message, time: time.toISOString() };
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    // A caller passed something JSON.stringify chokes on (circular reference, BigInt).
    // Losing the fields beats crashing the process from inside the logging path.
    return `${JSON.stringify({
      severity,
      message,
      time: time.toISOString(),
      loggingError: 'fields were not serializable and were dropped',
    })}\n`;
  }
}
