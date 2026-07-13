import type { Message } from '../types.js';
import type { ToolSchema } from '../tools/types.js';

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; stopReason: 'end' | 'tool_use' | 'max_tokens' };

export interface StreamOptions { model: string; systemPrompt: string; maxTokens: number; signal?: AbortSignal; }

export interface LLMProvider {
  name: string;
  stream(messages: Message[], tools: ToolSchema[], opts: StreamOptions): AsyncIterable<ProviderEvent>;
}

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { Config } from '../config/index.js';

export function getProvider(name: 'anthropic' | 'openai', config: Config): LLMProvider {
  if (name === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('No Anthropic API key. Run `mdd auth login`.');
    return new AnthropicProvider(config.anthropicApiKey);
  }
  if (!config.openaiApiKey) throw new Error('No OpenAI API key. Run `mdd auth login`.');
  return new OpenAIProvider(config.openaiApiKey, config.openaiBaseUrl);
}
