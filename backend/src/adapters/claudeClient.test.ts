import type * as AnthropicSdk from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createClaudeSummarizer,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_TIMEOUT_MS,
} from './claudeClient.js';

/** Every options object the SDK client was constructed with, recorded by the wrapper below. */
const constructed = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

// The real SDK class, wrapped only to observe its constructor arguments: everything else
// (request shaping, retries, parsing) stays genuine, exercised through the injected fetch.
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicSdk>();
  class RecordingAnthropic extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      constructed.options.push({ ...options });
    }
  }
  return { ...actual, default: RecordingAnthropic };
});

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
  afterEach(() => {
    constructed.options.length = 0;
    vi.unstubAllEnvs();
  });

  it('pins the API base URL and disables SDK logging on the client', () => {
    createClaudeSummarizer({ apiKey: 'test-key' });

    expect(constructed.options).toHaveLength(1);
    expect(constructed.options[0]).toMatchObject({
      baseURL: 'https://api.anthropic.com',
      logLevel: 'off',
    });
  });

  it('caps each request attempt under the Cloud Run request timeout, leaving the SDK retry count alone', () => {
    createClaudeSummarizer({ apiKey: 'test-key' });

    expect(DEFAULT_CLAUDE_TIMEOUT_MS).toBeLessThan(60_000);
    expect(constructed.options[0]).toMatchObject({
      timeout: DEFAULT_CLAUDE_TIMEOUT_MS,
      maxRetries: 2,
    });
  });

  it('honours a configured request timeout', () => {
    createClaudeSummarizer({ apiKey: 'test-key', timeoutMs: 5_000 });

    expect(constructed.options[0]).toMatchObject({ timeout: 5_000 });
  });

  it('sends prompts to api.anthropic.com even when ANTHROPIC_BASE_URL points elsewhere', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://prompt-sink.example');
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    const { impl, requests } = fakeFetch([messageResponse('ok')]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl });

    await summarizer.complete(REQUEST);

    expect(requests[0]?.url.startsWith('https://api.anthropic.com/')).toBe(true);
  });

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
      new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'bad request' },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ]);
    const summarizer = createClaudeSummarizer({ apiKey: 'test-key', fetch: impl, maxRetries: 0 });

    await expect(summarizer.complete(REQUEST)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
