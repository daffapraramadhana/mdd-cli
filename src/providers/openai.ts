import OpenAI from 'openai';
import type { LLMProvider, ProviderEvent, StreamOptions } from './index.js';
import type { Message } from '../types.js';
import type { ToolSchema } from '../tools/types.js';

type ClientFactory = (apiKey: string, baseURL?: string) => OpenAI;

export function toOpenAIMessages(messages: Message[], systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const toolUses = m.content.filter((b) => b.type === 'tool_use') as Array<{ id: string; name: string; input: unknown }>;
    const toolResults = m.content.filter((b) => b.type === 'tool_result') as Array<{ toolUseId: string; content: string }>;
    const images = m.content.filter((b) => b.type === 'image') as Array<{ mediaType: string; data: string }>;
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
      if (images.length) {
        out.push({
          role: 'user',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
          ],
        });
      } else if (text) {
        out.push({ role: 'user', content: text });
      }
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
    // Use the raw `create({ stream: true })` iterator, NOT the `.stream()` helper.
    // The helper runs a strict end-of-stream finalizer that throws
    // `missing finish_reason for choice 0` when an OpenAI-compatible backend (e.g.
    // Claude served via 9router) closes the stream without a per-choice
    // finish_reason. We accumulate everything we need ourselves, so the raw
    // iterator lets a non-strict backend degrade gracefully instead of crashing.
    const stream = await this.client.chat.completions.create({
      model: opts.model,
      max_completion_tokens: opts.maxTokens,
      messages: toOpenAIMessages(messages, opts.systemPrompt),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      stream: true,
      stream_options: { include_usage: true }, // ask for token counts in the final chunk
    }, { signal: opts.signal });

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;
    let sawText = false;
    const calls = new Map<string, { id: string; name: string; args: string }>();
    let autoKey = 0;

    for await (const chunk of stream as AsyncIterable<Record<string, any>>) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) { sawText = true; yield { type: 'text', text: choice.delta.content }; }
      for (const tc of choice.delta?.tool_calls ?? []) {
        // Some OpenAI-compatible backends omit the per-call `index`. Fall back to
        // the call id, then to insertion order, so parallel tool calls don't
        // collapse onto a single key.
        const key = tc.index != null ? `i${tc.index}` : tc.id ? `d${tc.id}` : `a${autoKey++}`;
        const cur = calls.get(key) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(key, cur);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    for (const c of calls.values()) {
      yield { type: 'tool_use', id: c.id, name: c.name, input: c.args ? JSON.parse(c.args) : {} };
    }
    if (inputTokens || outputTokens) yield { type: 'usage', inputTokens, outputTokens };

    // A stream that produced no text, no tool calls, no usage, and never signalled a
    // finish_reason was truncated upstream (dropped connection / router hiccup).
    // Surface it so the agent loop can retry, rather than returning an empty turn.
    if (!finishReason && !sawText && calls.size === 0 && !outputTokens) {
      throw new Error(`Stream from "${opts.model}" ended with no content and no finish_reason (truncated upstream).`);
    }

    // Derive stopReason from what we actually accumulated instead of trusting one
    // provider's exact finish_reason vocabulary. Any tool calls => a tool turn,
    // whatever the string (OpenAI "tool_calls"; some shims "tool_use" or none).
    // Length caps go by the OpenAI "length" / Anthropic "max_tokens" names.
    let stopReason: 'end' | 'tool_use' | 'max_tokens' = 'end';
    if (calls.size > 0) stopReason = 'tool_use';
    else if (finishReason === 'length' || finishReason === 'max_tokens') stopReason = 'max_tokens';
    yield { type: 'done', stopReason };
  }
}
