import { describe, expect, it } from 'vitest';
import { createClaudeSummarizer, DEFAULT_CLAUDE_MODEL } from './claudeClient.js';

interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
}

function messageResponse(text: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_CLAUDE_MODEL,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 340 },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function fakeFetch(responses: readonly Response[]) {
  const requests: RecordedRequest[] = [];
  const impl: typeof fetch = async (input, init) => {
    if (typeof init?.body !== 'string') {
      throw new Error('expected the SDK to send a string body');
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, body });
    const response = responses[requests.length - 1];
    if (response === undefined) {
      throw new Error(`test misconfiguration: no scripted response ${requests.length}`);
    }
    return Promise.resolve(response);
  };
  return { impl, requests };
}

const REQUEST = { system: 'system prompt', user: 'user prompt', maxOutputTokens: 900 };

describe('createClaudeSummarizer', () => {
  it('sends one Messages API call with the prompt and output cap', async () => {
    const { impl, requests } = fakeFetch([messageResponse('{"summaries":[]}')]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl });

    const reply = await summarizer.complete(REQUEST);

    expect(reply).toBe('{"summaries":[]}');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('/v1/messages');
    expect(requests[0]?.body).toMatchObject({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 900,
      system: 'system prompt',
      messages: [{ role: 'user', content: 'user prompt' }],
    });
  });

  it('honors a configured model override', async () => {
    const { impl, requests } = fakeFetch([messageResponse('ok')]);
    const summarizer = createClaudeSummarizer({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      fetch: impl,
    });

    await summarizer.complete(REQUEST);

    expect(requests[0]?.body['model']).toBe('claude-sonnet-4-6');
  });

  it('concatenates multiple text blocks and ignores non-text blocks', async () => {
    const { impl } = fakeFetch([
      messageResponse('', {
        content: [
          { type: 'text', text: '{"summaries":' },
          { type: 'text', text: '[]}' },
        ],
      }),
    ]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl });

    await expect(summarizer.complete(REQUEST)).resolves.toBe('{"summaries":[]}');
  });

  it('logs usage counts but never prompt or reply content', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = {
      debug: () => undefined,
      info: (message: string, fields?: Record<string, unknown>) =>
        void lines.push({ message, ...fields }),
      warn: (message: string, fields?: Record<string, unknown>) =>
        void lines.push({ message, ...fields }),
      error: () => undefined,
      child: () => logger,
    };
    const { impl } = fakeFetch([messageResponse('secret amharic summary')]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl, logger });

    await summarizer.complete(REQUEST);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ inputTokens: 1200, outputTokens: 340 });
    expect(JSON.stringify(lines)).not.toContain('secret amharic summary');
    expect(JSON.stringify(lines)).not.toContain('user prompt');
  });

  it('propagates API errors to the pipeline without retrying non-retryable statuses', async () => {
    const { impl, requests } = fakeFetch([
      new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl, maxRetries: 0 });

    await expect(summarizer.complete(REQUEST)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
