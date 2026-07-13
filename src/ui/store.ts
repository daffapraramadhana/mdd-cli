import { summarizePreview } from './format.js';
import type { SessionMeta } from './banner.js';

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown; status: 'ok' | 'error'; durationMs: number; preview?: string }
  | { kind: 'reasoning'; durationMs: number }
  | { kind: 'system'; text: string };

export interface ActiveTool { name: string; input: unknown; startedAt: number; }

export interface PendingSelect { title: string; options: string[]; }

export interface UiState {
  transcript: TranscriptItem[];
  streaming: string;
  reasoning: string;
  reasoningStartedAt: number | null;
  status: 'idle' | 'busy';
  pendingPrompt: string | null;
  meta: SessionMeta | null;
  activeTool: ActiveTool | null;
  themeName: string;
  pendingSelect: PendingSelect | null;
  usage: { inputTokens: number; outputTokens: number };
  turnStartedAt: number | null;
}

export class UiStore {
  private state: UiState = {
    transcript: [], streaming: '', reasoning: '', reasoningStartedAt: null, status: 'idle', pendingPrompt: null, meta: null, activeTool: null,
    themeName: 'neon', pendingSelect: null, usage: { inputTokens: 0, outputTokens: 0 }, turnStartedAt: null,
  };
  private listeners = new Set<() => void>();
  private resolver: ((answer: string) => void) | null = null;
  private selectResolver: ((value: string | null) => void) | null = null;
  private abortHook: (() => void) | null = null;

  constructor(private now: () => number = Date.now) {}

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
    this.collapseReasoning(); // first answer delta ends the reasoning block
    this.set({ streaming: this.state.streaming + delta });
  };

  appendReasoning = (delta: string): void => {
    this.set({
      reasoning: this.state.reasoning + delta,
      reasoningStartedAt: this.state.reasoningStartedAt ?? this.now(),
    });
  };

  // Reasoning "ends" (answer text starts, a tool starts, or the turn ends): drop the live
  // block and leave a compact "✻ Thought for Ns" summary in scrollback. Idempotent no-op
  // when no reasoning is pending, so it is safe to call from every end condition.
  private collapseReasoning(): void {
    if (this.state.reasoningStartedAt === null) return;
    const durationMs = Math.max(0, this.now() - this.state.reasoningStartedAt);
    this.set({
      transcript: [...this.state.transcript, { kind: 'reasoning', durationMs }],
      reasoning: '',
      reasoningStartedAt: null,
    });
  }

  commitStreaming = (): void => {
    this.collapseReasoning();
    if (!this.state.streaming) return;
    this.set({
      transcript: [...this.state.transcript, { kind: 'assistant', text: this.state.streaming }],
      streaming: '',
    });
  };

  // A tool begins: commit any streamed text, then show it as the live "running" item.
  startTool = (name: string, input: unknown): void => {
    this.commitStreaming();
    this.set({ activeTool: { name, input, startedAt: this.now() } });
  };

  // A tool finishes: move the active tool into the transcript with its outcome, elapsed time,
  // and (if the result summarizes to something) a one-line preview.
  endTool = (status: 'ok' | 'error', content?: string): void => {
    const active = this.state.activeTool;
    if (!active) return;
    const durationMs = Math.max(0, this.now() - active.startedAt);
    const preview = summarizePreview(active.name, content, status === 'error');
    const item: TranscriptItem = { kind: 'tool', name: active.name, input: active.input, status, durationMs, ...(preview ? { preview } : {}) };
    this.set({ transcript: [...this.state.transcript, item], activeTool: null });
  };

  setTheme = (themeName: string): void => { this.set({ themeName }); };

  addUsage = (inputTokens: number, outputTokens: number): void => {
    this.set({
      usage: {
        inputTokens: this.state.usage.inputTokens + inputTokens,
        outputTokens: this.state.usage.outputTokens + outputTokens,
      },
    });
  };

  // Interactive picker: returns the chosen option, or null if cancelled (Esc).
  requestSelect = (title: string, options: string[]): Promise<string | null> =>
    new Promise((resolve) => { this.selectResolver = resolve; this.set({ pendingSelect: { title, options } }); });

  resolveSelect = (value: string | null): void => {
    const r = this.selectResolver;
    this.selectResolver = null;
    this.set({ pendingSelect: null });
    r?.(value);
  };

  addSystem = (text: string): void => {
    this.set({ transcript: [...this.state.transcript, { kind: 'system', text }] });
  };

  // Restore a saved conversation: replace the transcript wholesale, drop any in-flight streaming.
  loadTranscript = (items: TranscriptItem[]): void => {
    this.set({ transcript: items, streaming: '', reasoning: '', reasoningStartedAt: null });
  };

  setStatus = (status: 'idle' | 'busy'): void => {
    this.set({ status, turnStartedAt: status === 'busy' ? this.now() : null });
  };

  setMeta = (meta: SessionMeta): void => { this.set({ meta }); };

  requestPrompt = (message: string): Promise<string> =>
    new Promise((resolve) => { this.resolver = resolve; this.set({ pendingPrompt: message }); });

  resolvePrompt = (answer: string): void => {
    const r = this.resolver;
    this.resolver = null;
    this.set({ pendingPrompt: null });
    r?.(answer);
  };

  setAbort = (fn: (() => void) | null): void => { this.abortHook = fn; };

  requestAbort = (): void => { this.abortHook?.(); };
}
