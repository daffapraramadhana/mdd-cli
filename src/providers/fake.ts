import type { LLMProvider, ProviderEvent, StreamOptions } from './index.js';
import type { Message } from '../types.js';
import type { ToolSchema } from '../tools/types.js';

export class FakeProvider implements LLMProvider {
  name = 'fake';
  private turn = 0;
  constructor(private scriptedTurns: ProviderEvent[][]) {}
  async *stream(_m: Message[], _t: ToolSchema[], _o: StreamOptions): AsyncIterable<ProviderEvent> {
    const events = this.scriptedTurns[this.turn] ?? [{ type: 'done', stopReason: 'end' } as ProviderEvent];
    this.turn++;
    for (const e of events) yield e;
  }
}
