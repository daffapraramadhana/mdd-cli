import { describe, it, expect } from 'vitest';
import { streamHandlers } from '../../src/cli.js';
import { UiStore } from '../../src/ui/store.js';

describe('streamHandlers', () => {
  it('routes <think> content to reasoning and the rest to streaming', () => {
    const store = new UiStore(() => 0);
    const h = streamHandlers(store);
    h.onText('<think>reasoning here</think>');
    expect(store.getState().reasoning).toBe('reasoning here');
    h.onText('visible answer');
    // first answer delta collapses reasoning into a summary
    expect(store.getState().reasoning).toBe('');
    expect(store.getState().streaming).toBe('visible answer');
    expect(store.getState().transcript.some((i) => i.kind === 'reasoning')).toBe(true);
  });

  it('surfaces an unterminated think block into pending reasoning state', () => {
    const store = new UiStore(() => 0);
    const h = streamHandlers(store);
    h.onText('answer');
    h.onText('<think>still going'); // no closing tag, no following answer text
    h.flush();
    // The handler leaves reasoning pending; the caller's commitStreaming collapses it at turn end.
    expect(store.getState().streaming).toBe('answer');
    expect(store.getState().reasoning).toBe('still going');
  });
});
