export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown };

export interface UiState {
  transcript: TranscriptItem[];
  streaming: string;
  status: 'idle' | 'busy';
  pendingPrompt: string | null;
}

export class UiStore {
  private state: UiState = { transcript: [], streaming: '', status: 'idle', pendingPrompt: null };
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

  addTool = (name: string, input: unknown): void => {
    this.commitStreaming();
    this.set({ transcript: [...this.state.transcript, { kind: 'tool', name, input }] });
  };

  setStatus = (status: 'idle' | 'busy'): void => { this.set({ status }); };

  requestPrompt = (message: string): Promise<string> =>
    new Promise((resolve) => { this.resolver = resolve; this.set({ pendingPrompt: message }); });

  resolvePrompt = (answer: string): void => {
    const r = this.resolver;
    this.resolver = null;
    this.set({ pendingPrompt: null });
    r?.(answer);
  };
}
