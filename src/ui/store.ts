import type { SessionMeta } from './banner.js';

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown; status: 'ok' | 'error' }
  | { kind: 'system'; text: string };

export interface ActiveTool { name: string; input: unknown; }

export interface UiState {
  transcript: TranscriptItem[];
  streaming: string;
  status: 'idle' | 'busy';
  pendingPrompt: string | null;
  meta: SessionMeta | null;
  activeTool: ActiveTool | null;
}

export class UiStore {
  private state: UiState = {
    transcript: [], streaming: '', status: 'idle', pendingPrompt: null, meta: null, activeTool: null,
  };
  private listeners = new Set<() => void>();
  private resolver: ((answer: string) => void) | null = null;

  getState = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  addUser = (text: string): void => {
    this.set({ transcript: [...this.state.transcript, { kind: 'user', text }] });
  };

  appendStreaming = (delta: string): void => {
    this.set({ streaming: this.state.streaming + delta });
  };

  commitStreaming = (): void => {
    if (!this.state.streaming) return;
    this.set({
      transcript: [...this.state.transcript, { kind: 'assistant', text: this.state.streaming }],
      streaming: '',
    });
  };

  // A tool begins: commit any streamed text, then show it as the live "running" item.
  startTool = (name: string, input: unknown): void => {
    this.commitStreaming();
    this.set({ activeTool: { name, input } });
  };

  // A tool finishes: move the active tool into the transcript with its outcome.
  endTool = (status: 'ok' | 'error'): void => {
    const active = this.state.activeTool;
    if (!active) return;
    this.set({
      transcript: [...this.state.transcript, { kind: 'tool', name: active.name, input: active.input, status }],
      activeTool: null,
    });
  };

  addSystem = (text: string): void => {
    this.set({ transcript: [...this.state.transcript, { kind: 'system', text }] });
  };

  setStatus = (status: 'idle' | 'busy'): void => { this.set({ status }); };

  setMeta = (meta: SessionMeta): void => { this.set({ meta }); };

  requestPrompt = (message: string): Promise<string> =>
    new Promise((resolve) => { this.resolver = resolve; this.set({ pendingPrompt: message }); });

  resolvePrompt = (answer: string): void => {
    const r = this.resolver;
    this.resolver = null;
    this.set({ pendingPrompt: null });
    r?.(answer);
  };
}
