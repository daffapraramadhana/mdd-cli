import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import type { ProviderEvent } from '../../src/providers/index.js';

// Minimal fake mirroring the Anthropic streaming events the provider consumes.
function fakeClient() {
  return {
    messages: {
      async *stream() {
        yield { type: 'content_block_start', content_block: { type: 'text' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
        yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_file' } };
        yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' } };
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
      },
    },
  };
}

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []; for await (const e of it) out.push(e); return out;
}

describe('AnthropicProvider', () => {
  it('translates Anthropic stream events into neutral events', async () => {
    const p = new AnthropicProvider('sk-test', () => fakeClient() as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'claude-opus-4-8', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
    expect(events).toContainEqual({ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a' } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});
