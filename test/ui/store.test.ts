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

  it('commits streaming on startTool, then records the tool with status on endTool', () => {
    const s = new UiStore();
    s.appendStreaming('thinking');
    s.startTool('read_file', { path: 'a' });
    // streaming is committed; the tool is "active" (running), not yet in the transcript
    expect(s.getState().transcript).toEqual([{ kind: 'assistant', text: 'thinking' }]);
    expect(s.getState().activeTool).toEqual({ name: 'read_file', input: { path: 'a' } });
    s.endTool('ok');
    expect(s.getState().activeTool).toBeNull();
    expect(s.getState().transcript).toEqual([
      { kind: 'assistant', text: 'thinking' },
      { kind: 'tool', name: 'read_file', input: { path: 'a' }, status: 'ok' },
    ]);
  });

  it('records an error status when a tool fails', () => {
    const s = new UiStore();
    s.startTool('run_shell', { command: 'false' });
    s.endTool('error');
    expect(s.getState().transcript).toEqual([
      { kind: 'tool', name: 'run_shell', input: { command: 'false' }, status: 'error' },
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

  it('adds a system item to the transcript', () => {
    const s = new UiStore();
    s.addSystem('→ model set to gpt-5');
    expect(s.getState().transcript).toEqual([{ kind: 'system', text: '→ model set to gpt-5' }]);
  });

  it('holds reactive session meta (starts null, updates on setMeta)', () => {
    const s = new UiStore();
    expect(s.getState().meta).toBeNull();
    s.setMeta({ provider: 'openai', model: 'cc/claude-opus-4-8', cwd: '~/p', branch: 'main' });
    expect(s.getState().meta).toMatchObject({ provider: 'openai', model: 'cc/claude-opus-4-8', branch: 'main' });
  });
});
