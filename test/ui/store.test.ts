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

  it('commits streaming on startTool, then records the tool with status + timing on endTool', () => {
    let t = 100;
    const s = new UiStore(() => t);
    s.appendStreaming('thinking');
    s.startTool('read_file', { path: 'a' });
    // streaming is committed; the tool is "active" (running), not yet in the transcript
    expect(s.getState().transcript).toEqual([{ kind: 'assistant', text: 'thinking' }]);
    expect(s.getState().activeTool).toEqual({ name: 'read_file', input: { path: 'a' }, startedAt: 100 });
    t = 175;
    s.endTool('ok');
    expect(s.getState().activeTool).toBeNull();
    expect(s.getState().transcript).toEqual([
      { kind: 'assistant', text: 'thinking' },
      { kind: 'tool', name: 'read_file', input: { path: 'a' }, status: 'ok', durationMs: 75 },
    ]);
  });

  it('records an error status when a tool fails', () => {
    let t = 0;
    const s = new UiStore(() => t);
    s.startTool('run_shell', { command: 'false' });
    t = 10;
    s.endTool('error');
    expect(s.getState().transcript).toEqual([
      { kind: 'tool', name: 'run_shell', input: { command: 'false' }, status: 'error', durationMs: 10 },
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

  it('accumulates token usage across turns', () => {
    const s = new UiStore();
    expect(s.getState().usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    s.addUsage(100, 20);
    s.addUsage(50, 10);
    expect(s.getState().usage).toEqual({ inputTokens: 150, outputTokens: 30 });
  });

  it('adds a system item to the transcript', () => {
    const s = new UiStore();
    s.addSystem('→ model set to gpt-5');
    expect(s.getState().transcript).toEqual([{ kind: 'system', text: '→ model set to gpt-5' }]);
  });

  it('resolves the requestSelect promise with the chosen option', async () => {
    const s = new UiStore();
    const p = s.requestSelect('Select a model', ['gpt-5', 'cc/claude-opus-4-8']);
    expect(s.getState().pendingSelect).toEqual({ title: 'Select a model', options: ['gpt-5', 'cc/claude-opus-4-8'] });
    s.resolveSelect('cc/claude-opus-4-8');
    expect(await p).toBe('cc/claude-opus-4-8');
    expect(s.getState().pendingSelect).toBeNull();
  });

  it('resolves requestSelect with null when cancelled', async () => {
    const s = new UiStore();
    const p = s.requestSelect('pick', ['a']);
    s.resolveSelect(null);
    expect(await p).toBeNull();
  });

  it('holds reactive session meta (starts null, updates on setMeta)', () => {
    const s = new UiStore();
    expect(s.getState().meta).toBeNull();
    s.setMeta({ provider: 'openai', model: 'cc/claude-opus-4-8', cwd: '~/p', branch: 'main' });
    expect(s.getState().meta).toMatchObject({ provider: 'openai', model: 'cc/claude-opus-4-8', branch: 'main' });
  });

  it('loadTranscript replaces the transcript wholesale and clears streaming', () => {
    const s = new UiStore();
    s.appendStreaming('x');
    s.addUser('old');
    s.loadTranscript([{ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'restored' }]);
    expect(s.getState().transcript).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'restored' },
    ]);
    expect(s.getState().streaming).toBe('');
  });

  it('accumulates reasoning and stamps the start time on the first delta', () => {
    let t = 200;
    const s = new UiStore(() => t);
    s.appendReasoning('let me ');
    t = 999; // later deltas must NOT move the start stamp
    s.appendReasoning('think');
    expect(s.getState().reasoning).toBe('let me think');
    expect(s.getState().transcript).toEqual([]); // not collapsed yet
  });

  it('collapses reasoning to a summary when the first answer text arrives', () => {
    let t = 100;
    const s = new UiStore(() => t);
    s.appendReasoning('pondering');
    t = 450;
    s.appendStreaming('Here is the answer');
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().reasoningStartedAt).toBeNull();
    expect(s.getState().streaming).toBe('Here is the answer');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 350 }]);
  });

  it('collapses reasoning before a tool call that has no preceding answer text', () => {
    let t = 0;
    const s = new UiStore(() => t);
    s.appendReasoning('I should read the file');
    t = 120;
    s.startTool('read_file', { path: 'a' });
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 120 }]);
    expect(s.getState().activeTool).toEqual({ name: 'read_file', input: { path: 'a' }, startedAt: 120 });
  });

  it('collapses trailing reasoning at turn end via commitStreaming', () => {
    let t = 10;
    const s = new UiStore(() => t);
    s.appendReasoning('unfinished thought');
    t = 60;
    s.commitStreaming();
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 50 }]);
  });

  it('emits only one reasoning summary per round even with interleaved answer deltas', () => {
    const s = new UiStore(() => 0);
    s.appendReasoning('think');
    s.appendStreaming('a');
    s.appendStreaming('b'); // second answer delta must not add another summary
    const reasoningItems = s.getState().transcript.filter((i) => i.kind === 'reasoning');
    expect(reasoningItems).toHaveLength(1);
  });

  it('produces no summary when there was no reasoning', () => {
    const s = new UiStore(() => 0);
    s.appendStreaming('just an answer');
    s.commitStreaming();
    expect(s.getState().transcript).toEqual([{ kind: 'assistant', text: 'just an answer' }]);
  });

  it('attaches a summarized preview to the committed tool item', () => {
    let t = 0;
    const s = new UiStore(() => t);
    s.startTool('list_dir', { path: '.' });
    t = 5;
    s.endTool('ok', 'a.ts\nb.ts');
    const item = s.getState().transcript.at(-1);
    expect(item).toEqual({ kind: 'tool', name: 'list_dir', input: { path: '.' }, status: 'ok', durationMs: 5, preview: '2 entries' });
  });

  it('omits preview when the summary is undefined', () => {
    const s = new UiStore(() => 0);
    s.startTool('edit_file', { path: 'a.ts' });
    s.endTool('ok', 'Edited a.ts');
    const item = s.getState().transcript.at(-1) as Record<string, unknown>;
    expect('preview' in item).toBe(false);
  });

  it('stamps turnStartedAt on busy and clears it on idle', () => {
    let t = 100;
    const s = new UiStore(() => t);
    expect(s.getState().turnStartedAt).toBeNull();
    s.setStatus('busy');
    expect(s.getState().turnStartedAt).toBe(100);
    s.setStatus('idle');
    expect(s.getState().turnStartedAt).toBeNull();
  });

  it('invokes the registered abort hook on requestAbort', () => {
    const s = new UiStore();
    let aborted = 0;
    s.setAbort(() => { aborted += 1; });
    s.requestAbort();
    expect(aborted).toBe(1);
    s.setAbort(null);
    s.requestAbort(); // no hook -> no throw, no increment
    expect(aborted).toBe(1);
  });
});
