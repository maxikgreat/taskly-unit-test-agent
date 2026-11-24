import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Config } from './config.ts';

// A small injection seam for deterministic tests and other compatible providers.
// The SDK passes unknown JSON fields through: retain DeepSeek reasoning verbatim.
export type Message = ChatCompletionMessageParam & { reasoning_content?: string | null };
export interface LanguageModel {
  complete(request: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
}

export function deepSeek(config: Config, apiKey = process.env.DEEPSEEK_API_KEY): LanguageModel {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com', timeout: config.timeoutMs, maxRetries: 0 });
  return {
    async complete(request) {
      // Retry only transient statuses, once. SDK retrying is disabled so there
      // are no hidden calls. Never forward provider errors (may contain inputs).
      for (let attempt = 0; ; attempt++) {
        try {
          const body = { ...request, thinking: { type: 'enabled' }, reasoning_effort: config.reasoningEffort };
          // The SDK's OpenAI enum omits DeepSeek's supported "max" effort.
          // This cast is confined to the provider boundary; JSON passes through.
          return await client.chat.completions.create(body as unknown as ChatCompletionCreateParamsNonStreaming);
        } catch (error) {
          const status = error instanceof OpenAI.APIError ? error.status : undefined;
          if (attempt === 0 && (status === 429 || (status !== undefined && status >= 500))) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          throw new Error(`LLM request failed${status ? ` (HTTP ${status})` : ' (connection or timeout)'}`);
        }
      }
    },
  };
}
