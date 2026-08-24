const TRACE_ID = /^[0-9a-f]{32}$/i;

/**
 * Extracts the trace id from Cloud Run's `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1`
 * header. Returns undefined for anything that is not a well-formed trace id — the header
 * arrives from outside the process and a bad value would produce a broken log field.
 */
export function parseTraceId(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const traceId = header.split('/', 1)[0];
  return traceId !== undefined && TRACE_ID.test(traceId) ? traceId : undefined;
}

/** The resource name Cloud Logging expects in `logging.googleapis.com/trace`. */
export function traceResourceName(projectId: string, traceId: string): string {
  return `projects/${projectId}/traces/${traceId}`;
}
