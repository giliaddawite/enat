import Anthropic from '@anthropic-ai/sdk';
import type { SummarizerPort } from '../domain/digestPipeline.js';
import type { Logger } from '../logging/logger.js';

/**
 * The real `SummarizerPort`: one Messages API call per digest batch via the official
 * Anthropic SDK, which already retries 429/5xx with backoff. Deliberately thin — prompt
 * construction, response validation, the retry-then-fallback ladder and caching all live
 * in the domain pipeline, so this file is the only place that knows Claude is on the
 * other end.
 *
 * Privacy: nothing here logs prompt or reply content — the prompt embeds email bodies.
 * Log lines carry the model name, token counts and stop reason only.
 */

/**
 * Haiku is the only current model whose pricing ($1/M input, $5/M output as of
 * 2026-08-25) fits the ticket's ≤ $0.05-per-digest budget at 50 emails/day — the token
 * math is in docs/digest-cost.md. Overridable so the model can be upgraded by
 * configuration when pricing or budget changes, not by a code change.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';

export interface ClaudeSummarizerOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Injected in tests so no request ever leaves the process. */
  readonly fetch?: typeof fetch;
  /** SDK-level transport retries for 429/5xx; the domain's single schema retry is separate. */
  readonly maxRetries?: number;
  /** Receives usage metadata only — model, token counts, stop reason. Never content. */
  readonly logger?: Logger;
}

export function createClaudeSummarizer(options: ClaudeSummarizerOptions): SummarizerPort {
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries ?? 2,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return {
    async complete({ system, user, maxOutputTokens }) {
      const response = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      // Cost observability (guiding principle 5): every batch logs what it spent.
      options.logger?.info('claude digest batch completed', {
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      });
      if (response.stop_reason === 'max_tokens') {
        // A truncated reply is almost certainly unparseable JSON; the pipeline's
        // validation catches it, but the cause is worth naming in the logs.
        options.logger?.warn('claude digest batch hit the output token cap', {
          maxOutputTokens,
        });
      }
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    },
  };
}
