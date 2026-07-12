import { describe, it, expect } from 'vitest';
import { FakeProvider } from '../../src/providers/fake.js';
import type { ProviderEvent } from '../../src/providers/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('FakeProvider', () => {
  it('yields each scripted turn in order', async () => {
    const p = new FakeProvider([
      [{ type: 'tool_use', id: '1', name: 'read_file', input: { path: 'a' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    const t1 = await collect(p.stream([], [], { model: 'x', systemPrompt: '', maxTokens: 10 }));
    expect(t1[0]).toMatchObject({ type: 'tool_use', name: 'read_file' });
    const t2 = await collect(p.stream([], [], { model: 'x', systemPrompt: '', maxTokens: 10 }));
    expect(t2[0]).toMatchObject({ type: 'text', text: 'done' });
  });
});
