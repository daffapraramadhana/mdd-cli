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
