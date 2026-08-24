import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  estimateTokens,
  htmlToText,
  pickBodyText,
  truncateToTokenBudget,
} from './emailText.js';

describe('estimateTokens', () => {
  it('counts ASCII text at four characters per token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('counts non-ASCII code points as one token each', () => {
    // Amharic greeting — five Ge'ez characters at one token each, plus one ASCII space.
    expect(estimateTokens('ሰላም ነው')).toBe(6);
  });

  it('returns zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('truncateToTokenBudget', () => {
  it('returns text unchanged when it fits the budget', () => {
    expect(truncateToTokenBudget('short text', 100)).toBe('short text');
  });

  it('cuts ASCII text at the budgeted length', () => {
    const text = 'a'.repeat(400);

    const truncated = truncateToTokenBudget(text, 10);

    expect(truncated).toBe('a'.repeat(40));
  });

  it('charges non-ASCII characters a full token so Amharic is not under-budgeted', () => {
    const amharic = 'ሀ'.repeat(50);

    expect(truncateToTokenBudget(amharic, 10)).toBe('ሀ'.repeat(10));
  });

  it('never splits a surrogate pair', () => {
    const emoji = '😀'.repeat(20);

    const truncated = truncateToTokenBudget(emoji, 5);

    expect(truncated).toBe('😀'.repeat(5));
    expect(truncated).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateToTokenBudget('anything', 0)).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('a &amp; b &#39;c&#39; &#x41;&nbsp;d')).toBe("a & b 'c' A d");
  });

  it('passes unknown entities through unchanged', () => {
    expect(decodeHtmlEntities('&notarealentity; &#xfffffff;')).toBe(
      '&notarealentity; &#xfffffff;',
    );
  });
});

describe('htmlToText', () => {
  it('strips tags and preserves paragraph breaks as newlines', () => {
    const html = '<div><p>First paragraph</p><p>Second<br>line</p></div>';

    expect(htmlToText(html)).toBe('First paragraph\nSecond\nline');
  });

  it('drops style, script and comment content entirely', () => {
    const html =
      '<style>body { color: red }</style><script>alert("x")</script><!-- hidden -->Visible';

    expect(htmlToText(html)).toBe('Visible');
  });

  it('decodes entities and collapses whitespace runs', () => {
    const html = '<p>Tom   &amp;\n\n\n  Jerry</p>';

    expect(htmlToText(html)).toBe('Tom & Jerry');
  });
});

describe('pickBodyText', () => {
  it('prefers a text/plain part over html', () => {
    const parts = [
      { mimeType: 'text/html', text: '<b>Rich</b>' },
      { mimeType: 'text/plain; charset=UTF-8', text: 'Plain body' },
    ];

    expect(pickBodyText(parts)).toBe('Plain body');
  });

  it('strips the html part when no usable plain part exists', () => {
    const parts = [
      { mimeType: 'text/plain', text: '   ' },
      { mimeType: 'text/html', text: '<p>Fallback body</p>' },
    ];

    expect(pickBodyText(parts)).toBe('Fallback body');
  });

  it('returns an empty string when no text parts exist', () => {
    expect(pickBodyText([{ mimeType: 'image/png', text: '' }])).toBe('');
    expect(pickBodyText([])).toBe('');
  });
});
