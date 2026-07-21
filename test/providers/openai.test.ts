import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import type { ProviderEvent } from '../../src/providers/index.js';

// The provider uses `chat.completions.create({ stream: true })` (raw iterator), so
// fakes expose `create` returning an async-iterable of chunks.
function clientFrom(chunks: Record<string, unknown>[]) {
  return {
    chat: {
      completions: {
        create() {
          return (async function* () { for (const c of chunks) yield c; })();
        },
      },
    },
  };
}

function fakeClient() {
  return clientFrom([
    { choices: [{ delta: { content: 'hi' }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 200, completion_tokens: 12 } }, // final usage chunk
  ]);
}
async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []; for await (const e of it) out.push(e); return out;
}

// Two parallel tool_calls, interleaved across chunks by distinct `index`.
function fakeClientTwoTools() {
  return clientFrom([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"b"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
}

describe('OpenAIProvider', () => {
  it('translates OpenAI streaming chunks into neutral events', async () => {
    const p = new OpenAIProvider('sk-test', undefined, () => fakeClient() as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'gpt-5', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a' } });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 200, outputTokens: 12 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('routes tool_calls deltas to the matching index for parallel tool calls', async () => {
    const p = new OpenAIProvider('sk-test', undefined, () => fakeClientTwoTools() as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'gpt-5', systemPrompt: 's', maxTokens: 100 })
    );
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'read_file', input: { path: 'a' } },
      { type: 'tool_use', id: 'call_b', name: 'read_file', input: { path: 'b' } },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('treats accumulated tool calls as a tool turn even when finish_reason is a non-OpenAI string (e.g. Claude "tool_use" via 9router)', async () => {
    const client = clientFrom([
      // Claude-via-9router style: whole tool call in one chunk, NO `index`, native finish_reason.
      { choices: [{ delta: { tool_calls: [{ id: 'toolu_1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_use' }] },
    ]);
    const p = new OpenAIProvider('sk-test', undefined, () => client as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'cc/claude-sonnet-5', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events).toContainEqual({ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a' } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('does not throw when the backend omits finish_reason but did stream content (degrades to stopReason "end")', async () => {
    const client = clientFrom([
      { choices: [{ delta: { content: 'answer' }, finish_reason: null }] },
      // stream just ends — no terminating finish_reason chunk (the case that crashed `.stream()`)
    ]);
    const p = new OpenAIProvider('sk-test', undefined, () => client as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'cc/claude-opus-4-8', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events).toContainEqual({ type: 'text', text: 'answer' });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });

  it('maps a "max_tokens" finish_reason (Anthropic vocab) to stopReason "max_tokens"', async () => {
    const client = clientFrom([
      { choices: [{ delta: { content: 'truncated…' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'max_tokens' }] },
    ]);
    const p = new OpenAIProvider('sk-test', undefined, () => client as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'cc/claude-sonnet-5', systemPrompt: 's', maxTokens: 4 })
    );
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('throws on a genuinely empty/truncated stream (no content, no finish_reason, no usage)', async () => {
    const client = clientFrom([{ choices: [] }]); // upstream dropped the connection
    const p = new OpenAIProvider('sk-test', undefined, () => client as never);
    await expect(
      collect(p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'cc/claude-sonnet-5', systemPrompt: 's', maxTokens: 100 }))
    ).rejects.toThrow(/truncated upstream/i);
  });

  it('routes parallel tool calls that omit `index` to distinct slots by id', async () => {
    const client = clientFrom([
      { choices: [{ delta: { tool_calls: [{ id: 'a', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ id: 'b', function: { name: 'read_file', arguments: '{"path":"b"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_use' }] },
    ]);
    const p = new OpenAIProvider('sk-test', undefined, () => client as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'cc/claude-sonnet-5', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 'a', name: 'read_file', input: { path: 'a' } },
      { type: 'tool_use', id: 'b', name: 'read_file', input: { path: 'b' } },
    ]);
  });

  it('passes a custom base URL (e.g. 9router) to the OpenAI client factory', () => {
    let seenKey: string | undefined;
    let seenBaseURL: string | undefined;
    new OpenAIProvider('sk-9r', 'http://localhost:20128/v1', (k, b) => {
      seenKey = k;
      seenBaseURL = b;
      return fakeClient() as never;
    });
    expect(seenKey).toBe('sk-9r');
    expect(seenBaseURL).toBe('http://localhost:20128/v1');
  });

  it('leaves base URL undefined when none is provided (SDK falls back to env/default)', () => {
    let seenBaseURL: string | undefined = 'sentinel';
    new OpenAIProvider('sk-test', undefined, (_k, b) => {
      seenBaseURL = b;
      return fakeClient() as never;
    });
    expect(seenBaseURL).toBeUndefined();
  });
});

import { toOpenAIMessages } from '../../src/providers/openai.js';
import type { Message } from '../../src/types.js';

describe('toOpenAIMessages image mapping', () => {
  it('builds an array content with an image_url data URL when images are present', () => {
    const messages: Message[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', mediaType: 'image/jpeg', data: 'QUJD' },
      ],
    }];
    const out = toOpenAIMessages(messages, 'sys');
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ],
    });
  });

  it('keeps a plain string content for text-only user messages', () => {
    const out = toOpenAIMessages([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], 'sys');
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
  });
});
