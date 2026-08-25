import type { Email } from './email.js';
import { truncateToTokenBudget } from './emailText.js';

/**
 * The digest prompt template (TICKET-104). The template lives in the repo and carries an
 * explicit version: every cached summary and every log line records which prompt produced
 * it, so a category regression is traceable to the prompt change that caused it. Any edit
 * to the strings below must bump PROMPT_VERSION and update the golden files in the same
 * commit — the golden test enforces the second half of that.
 */
export const PROMPT_VERSION = 'digest-v1';

export interface DigestPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The system half is static — same bytes every call — so it stays a cacheable prefix and
 * never smuggles per-request data. The one Amharic sentence is the example summary; it is
 * model guidance, not UI text, but it still gets human review like every Amharic string.
 */
const SYSTEM_PROMPT = [
  'You are the email summarizer for Enat, a phone companion app for an elderly',
  'Amharic-speaking woman. You will receive a batch of her emails. For each email produce:',
  '- "category": one of "important" (personal or consequential mail needing her attention:',
  '  appointments, church or community matters, government or medical notices),',
  '  "bills_accounts" (money: bills, bank or account statements, payments, subscriptions),',
  '  "family_personal" (mail written to her by a person: family or friends),',
  '  "promotions_other" (marketing, newsletters, social notifications, automated mail',
  '  needing nothing from her).',
  '- "summary": one or two short sentences in simple, warm Amharic telling her what the',
  '  email says and what, if anything, she should do. Write for an older adult: plain',
  '  everyday words, no technical terms, no English words.',
  '- "urgent": true only if she must act within a few days (a payment due, an appointment,',
  '  a deadline); otherwise false.',
  '',
  'Reply with only a JSON object — no other text, no code fences — in exactly this shape:',
  '{"summaries":[{"messageId":"<id>","category":"...","summary":"...","urgent":false}]}',
  "Include exactly one entry per email, copying each email's id verbatim.",
  'Example summary value: "የባንክ መግለጫዎ ደርሷል፤ ምንም ክፍያ አያስፈልግም።"',
].join('\n');

/** Email text is untrusted; strip anything resembling our own delimiters so a malicious
 * mail cannot close its element and impersonate the instructions around it. */
function sanitize(text: string): string {
  return text.replace(/<\/?email\b/gi, '');
}

/**
 * Renders one email as the block the batch prompt (and the token-budget planner) uses.
 * The body is expected to be pre-truncated by `fetchBodies`; the snippet fallback for
 * bodiless emails is cut to the same per-email budget here.
 */
export function renderEmailBlock(email: Email, maxBodyTokens: number): string {
  const body = email.bodyText ?? truncateToTokenBudget(email.snippet, maxBodyTokens);
  return [
    `<email id="${email.id}">`,
    `From: ${sanitize(email.from)}`,
    `Subject: ${sanitize(email.subject)}`,
    `Received: ${email.receivedAt}`,
    `Body: ${sanitize(body)}`,
    '</email>',
  ].join('\n');
}

/**
 * Builds the one prompt for a whole digest batch — one LLM call for N emails, never one
 * per email. `today` anchors the urgency judgment ("due in a few days") and is injected
 * by the caller, never read from a clock here.
 */
export function buildDigestPrompt(
  emails: readonly Email[],
  today: string,
  maxBodyTokens: number,
): DigestPrompt {
  const blocks = emails.map((email) => renderEmailBlock(email, maxBodyTokens));
  return {
    system: SYSTEM_PROMPT,
    user: [
      `Today's date: ${today}`,
      `Summarize and categorize these ${emails.length} emails.`,
      '',
      ...blocks,
    ].join('\n'),
  };
}

/** How much of an invalid reply the retry prompt echoes back — enough for the model to
 * see what it did wrong, small enough not to double the input bill. */
const RETRY_ECHO_TOKENS = 500;

/**
 * The one schema-validated retry CLAUDE.md allows after a parse failure. The invalid
 * reply is echoed (truncated) because with an unchanged prompt the model would likely
 * reproduce the same malformed output.
 */
export function buildRetryPrompt(original: DigestPrompt, invalidReply: string): DigestPrompt {
  return {
    system: original.system,
    user: [
      original.user,
      '',
      'Your previous reply could not be parsed as the required JSON. It began:',
      truncateToTokenBudget(invalidReply, RETRY_ECHO_TOKENS),
      'Reply again with only the JSON object in the required shape — nothing else.',
    ].join('\n'),
  };
}
