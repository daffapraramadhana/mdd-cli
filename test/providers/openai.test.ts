import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import type { ProviderEvent } from '../../src/providers/index.js';

function fakeClient() {
  return {
    chat: {
      completions: {
        async *stream() {
          yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      },
    },
  };
}
async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []; for await (const e of it) out.push(e); return out;
}

// Two parallel tool_calls, interleaved across chunks by distinct `index`.
function fakeClientTwoTools() {
  return {
    chat: {
      completions: {
        async *stream() {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"b"}' } }] }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      },
    },
  };
}

describe('OpenAIProvider', () => {
  it('translates OpenAI streaming chunks into neutral events', async () => {
    const p = new OpenAIProvider('sk-test', () => fakeClient() as never);
    const events = await collect(
      p.stream([{ role: 'user', content: [{ type: 'text', text: 'go' }] }], [], { model: 'gpt-5', systemPrompt: 's', maxTokens: 100 })
    );
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a' } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('routes tool_calls deltas to the matching index for parallel tool calls', async () => {
    const p = new OpenAIProvider('sk-test', () => fakeClientTwoTools() as never);
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
});
