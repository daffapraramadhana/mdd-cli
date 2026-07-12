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
});
