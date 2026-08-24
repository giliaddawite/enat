import { decodeHtmlEntities } from './emailText.js';

/**
 * The internal, normalized email model (TICKET-103). Everything downstream of ingestion —
 * categorization, token budgeting, the digest pipeline — works on this shape and never on
 * a raw Gmail resource.
 */
export interface Email {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  /** ISO 8601. A string, not a Date, so the domain layer stays framework-free. */
  readonly receivedAt: string;
  readonly labels: readonly string[];
  /**
   * `null` until the body is deliberately fetched for summarization. Bodies are fetched
   * only for messages that will be summarized (a separate, batched call), never as part
   * of listing — that is what keeps a sync of a large inbox cheap.
   */
  readonly bodyText: string | null;
}

/**
 * What the Gmail adapter hands the domain for one message fetched with `format=metadata`.
 * A plain, already-validated shape — wire concerns (zod parsing, base64, batching) stay in
 * the adapter, and this type keeps the domain free of transport imports.
 */
export interface GmailMessageMetadata {
  readonly id: string;
  readonly threadId: string;
  /** Header name → value, names lowercased by the adapter. */
  readonly headers: Readonly<Record<string, string>>;
  readonly snippet: string;
  /** Milliseconds since the epoch — Gmail's `internalDate`, when Gmail received the mail. */
  readonly internalDate: number;
  readonly labelIds: readonly string[];
}

/**
 * Maps one metadata-fetched Gmail message onto the internal model. Missing headers become
 * empty strings rather than failures: a mail with no Subject is normal, and the digest
 * pipeline treats an empty field as "nothing to show", not an error. `internalDate` is
 * preferred over the Date header because Gmail always sets it and it needs no parsing of
 * RFC 2822 date formats.
 */
export function normalizeGmailMessage(message: GmailMessageMetadata): Email {
  return {
    id: message.id,
    threadId: message.threadId,
    from: message.headers['from'] ?? '',
    subject: message.headers['subject'] ?? '',
    // Gmail HTML-escapes snippets (&#39; and friends); the model holds plain text.
    snippet: decodeHtmlEntities(message.snippet),
    receivedAt: new Date(message.internalDate).toISOString(),
    labels: message.labelIds,
    bodyText: null,
  };
}
