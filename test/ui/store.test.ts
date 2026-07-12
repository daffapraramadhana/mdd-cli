import { describe, it, expect } from 'vitest';
import { UiStore } from '../../src/ui/store.js';

describe('UiStore', () => {
  it('appends streaming text and commits it into the transcript', () => {
    const s = new UiStore();
    s.appendStreaming('hel');
    s.appendStreaming('lo');
    expect(s.getState().streaming).toBe('hello');
    s.commitStreaming();
    expect(s.getState().streaming).toBe('');
    expect(s.getState().transcript).toEqual([{ kind: 'assistant', text: 'hello' }]);
  });

  it('commits pending streaming text before adding a tool item', () => {
    const s = new UiStore();
    s.appendStreaming('thinking');
    s.addTool('read_file', { path: 'a' });
    expect(s.getState().transcript).toEqual([
      { kind: 'assistant', text: 'thinking' },
      { kind: 'tool', name: 'read_file', input: { path: 'a' } },
    ]);
  });

  it('resolves the requestPrompt promise when resolvePrompt is called', async () => {
    const s = new UiStore();
    const p = s.requestPrompt('Allow write_file? [y/n/a]');
    expect(s.getState().pendingPrompt).toBe('Allow write_file? [y/n/a]');
    s.resolvePrompt('y');
    expect(await p).toBe('y');
    expect(s.getState().pendingPrompt).toBeNull();
  });

  it('notifies subscribers on state change', () => {
    const s = new UiStore();
    let calls = 0;
    const unsub = s.subscribe(() => { calls++; });
    s.setStatus('busy');
    expect(calls).toBe(1);
    unsub();
    s.setStatus('idle');
    expect(calls).toBe(1);
  });
});
