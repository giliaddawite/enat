/**
 * The per-email summarization result (TICKET-104). One record per Gmail message: the
 * digest bucket it belongs to, an optional 1–2 sentence Amharic summary, and an urgency
 * flag. Everything downstream — digest assembly, the API, the app — works on this shape.
 */

/**
 * The four digest buckets from the ticket, as stable wire identifiers. The Android app
 * owns the user-facing Amharic labels (its `values-am/strings.xml`); the backend never
 * ships display text for categories, only these keys.
 */
export const EMAIL_CATEGORIES = [
  'important',
  'bills_accounts',
  'family_personal',
  'promotions_other',
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export interface EmailSummary {
  readonly messageId: string;
  readonly category: EmailCategory;
  /** 1–2 sentence Amharic summary; `null` when the email got category-only treatment. */
  readonly summary: string | null;
  /** True when the email needs the reader's attention within days (a due bill, an
   * appointment). Heuristic results never claim urgency — only the LLM sets this. */
  readonly urgent: boolean;
  /** Where this result came from: a fresh LLM call, the Firestore cache of a previous
   * LLM call, or the sender-domain heuristics (LLM skipped or failed). */
  readonly source: 'llm' | 'cache' | 'heuristic';
  /** Prompt template version that produced an LLM summary; `null` for heuristic results.
   * Stored and logged with each result so a category regression can be traced to the
   * prompt change that caused it. */
  readonly promptVersion: string | null;
}

/** An `EmailSummary` that is allowed into the Firestore cache: only real LLM output is
 * cached, so the summary and prompt version are always present. */
export interface CacheableEmailSummary extends EmailSummary {
  readonly summary: string;
  readonly promptVersion: string;
}
