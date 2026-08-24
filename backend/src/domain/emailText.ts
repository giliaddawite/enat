/**
 * Pure text utilities for the ingestion pipeline: HTML → plain text, entity decoding, and
 * token-budget truncation. No I/O, no framework imports — everything here is deterministic
 * on its inputs.
 */

/**
 * Token cost estimate per character. ASCII text runs ~4 characters per token on Claude's
 * tokenizer; non-ASCII scripts (including the Ge'ez script Amharic uses) tokenize far
 * denser, so each non-ASCII code point is counted as a full token. Deliberately
 * conservative — overestimating cost trims a little more text, underestimating blows the
 * per-digest budget CLAUDE.md caps.
 */
const ASCII_TOKENS_PER_CHAR = 0.25;

function tokenCost(codePoint: number): number {
  return codePoint <= 0x7f ? ASCII_TOKENS_PER_CHAR : 1;
}

/** Estimated Claude token count for `text`, per the heuristic above. */
export function estimateTokens(text: string): number {
  let cost = 0;
  for (const character of text) {
    // `for..of` iterates code points, so surrogate pairs are one unit.
    cost += tokenCost(character.codePointAt(0) ?? 0);
  }
  return Math.ceil(cost);
}

/**
 * Cuts `text` so its estimated token count fits `maxTokens`. Truncation happens at a code
 * point boundary — never inside a surrogate pair — so the result is always valid text.
 * The budget is an explicit parameter on purpose: the digest pipeline (TICKET-104) owns
 * how the per-digest cap is split across emails; this function only enforces one slice.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }
  let cost = 0;
  let end = 0;
  for (const character of text) {
    cost += tokenCost(character.codePointAt(0) ?? 0);
    if (cost > maxTokens) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes the HTML entities that actually occur in email text: the common named ones plus
 * numeric (decimal and hex) references. Unknown entities pass through untouched — mangling
 * text the sender wrote would be worse than leaving an escape visible.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Strips an HTML email body to readable plain text. Regex-based on purpose: a real HTML
 * parser dependency does not earn its weight for "remove markup before summarization",
 * and imperfect output only costs a few tokens, never correctness. Block-level closings
 * become newlines so paragraphs survive; style/script/comment content is dropped entirely.
 */
export function htmlToText(html: string): string {
  const withoutHiddenContent = html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Newlines in HTML source are rendering whitespace, not line breaks — only the
    // block-level tags below produce real breaks in the output.
    .replace(/\s+/g, ' ');
  const withBreaks = withoutHiddenContent
    .replace(/<\s*(?:br|hr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return collapseWhitespace(decodeHtmlEntities(withBreaks));
}

/**
 * Picks the body text from a message's MIME parts: a `text/plain` part wins outright
 * (senders author it as readable text), otherwise `text/html` is stripped. Anything else
 * (images, attachments) contributes nothing.
 */
export function pickBodyText(
  parts: readonly { readonly mimeType: string; readonly text: string }[],
): string {
  const plain = parts.find((part) => part.mimeType.toLowerCase().startsWith('text/plain'));
  if (plain !== undefined && plain.text.trim().length > 0) {
    return collapseWhitespace(plain.text);
  }
  const html = parts.find((part) => part.mimeType.toLowerCase().startsWith('text/html'));
  if (html !== undefined) {
    return htmlToText(html.text);
  }
  return '';
}

/**
 * Collapses runs of spaces and blank lines. Every collapsed character is a token the
 * digest does not pay for — HTML emails are mostly whitespace once tags are stripped.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
