import OpenAI from 'openai';
import type { LLMProvider, ProviderEvent, StreamOptions } from './index.js';
import type { Message } from '../types.js';
import type { ToolSchema } from '../tools/types.js';

type ClientFactory = (apiKey: string, baseURL?: string) => OpenAI;

function toOpenAIMessages(messages: Message[], systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const toolUses = m.content.filter((b) => b.type === 'tool_use') as Array<{ id: string; name: string; input: unknown }>;
    const toolResults = m.content.filter((b) => b.type === 'tool_result') as Array<{ toolUseId: string; content: string }>;
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.length
          ? toolUses.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input) } }))
          : undefined,
      });
    } else {
      for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  constructor(
    apiKey: string,
    baseURL?: string,
    factory: ClientFactory = (k, b) => new OpenAI({ apiKey: k, baseURL: b }),
  ) {
    this.client = factory(apiKey, baseURL);
  }

  async *stream(messages: Message[], tools: ToolSchema[], opts: StreamOptions): AsyncIterable<ProviderEvent> {
    const stream = await this.client.chat.completions.stream({
      model: opts.model,
      max_completion_tokens: opts.maxTokens,
      messages: toOpenAIMessages(messages, opts.systemPrompt),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    }, { signal: opts.signal });

    let stopReason: 'end' | 'tool_use' | 'max_tokens' = 'end';
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream as AsyncIterable<Record<string, any>>) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) yield { type: 'text', text: choice.delta.content };
      for (const tc of choice.delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
      else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
      else if (choice.finish_reason === 'stop') stopReason = 'end';
    }
    for (const c of calls.values()) {
      yield { type: 'tool_use', id: c.id, name: c.name, input: c.args ? JSON.parse(c.args) : {} };
    }
    yield { type: 'done', stopReason };
  }
}
