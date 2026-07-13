import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ProviderEvent, StreamOptions } from './index.js';
import type { Message } from '../types.js';
import type { ToolSchema } from '../tools/types.js';

type ClientFactory = (apiKey: string) => Anthropic;

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text' as const, text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
      return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
    }),
  }));
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  constructor(apiKey: string, factory: ClientFactory = (k) => new Anthropic({ apiKey: k })) {
    this.client = factory(apiKey);
  }

  async *stream(messages: Message[], tools: ToolSchema[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const stream = this.client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.systemPrompt,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    }, { signal: opts.signal });

    let stopReason: 'end' | 'tool_use' | 'max_tokens' = 'end';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolBuf = new Map<number, { id: string; name: string; json: string }>();

    for await (const ev of stream as AsyncIterable<Record<string, any>>) {
      if (ev.type === 'message_start') {
        inputTokens = ev.message?.usage?.input_tokens ?? 0;
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        toolBuf.set(ev.index ?? 0, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        yield { type: 'text', text: ev.delta.text };
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
        const b = toolBuf.get(ev.index);
        if (b) b.json += ev.delta.partial_json;
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason === 'tool_use' ? 'tool_use' : ev.delta.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
        if (ev.usage?.output_tokens != null) outputTokens = ev.usage.output_tokens;
      }
    }
    for (const b of toolBuf.values()) {
      yield { type: 'tool_use', id: b.id, name: b.name, input: b.json ? JSON.parse(b.json) : {} };
    }
    if (inputTokens || outputTokens) yield { type: 'usage', inputTokens, outputTokens };
    yield { type: 'done', stopReason };
  }
}
