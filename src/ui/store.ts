import { summarizePreview } from './format.js';
import type { SessionMeta } from './banner.js';
import type { UpdateInfo } from '../update.js';
import type { QuotaSummary } from '../quota.js';
import type { PromptSpec, ChoiceOption, ChoiceResult } from './select.js';

// Split a live streaming markdown buffer into a prefix that is safe to flush into scrollback
// (`committed`) and a trailing remainder that must stay in the live frame (`rest`). The cut is
// the LAST blank line that is NOT inside an open ``` fenced code block — so we never commit a
// half-rendered block (an open fence, a list still growing). `committed` is '' when no safe
// boundary exists yet, i.e. the whole buffer stays live.
export function splitStreamable(buf: string): { committed: string; rest: string } {
  const lines = buf.split('\n');
  let inFence = false;
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && lines[i].trim() === '' && i > 0) cut = i;
  }
  if (cut < 0) return { committed: '', rest: buf };
  return { committed: lines.slice(0, cut).join('\n'), rest: lines.slice(cut + 1).join('\n') };
}

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown; status: 'ok' | 'error'; durationMs: number; preview?: string }
  | { kind: 'reasoning'; durationMs: number }
  | { kind: 'system'; text: string };

export interface ActiveTool { name: string; input: unknown; startedAt: number; }

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
  pendingChoice: PromptSpec | null;
  usage: { inputTokens: number; outputTokens: number };
  turnStartedAt: number | null;
  update: UpdateInfo | null;
  quota: QuotaSummary | null;
}

export class UiStore {
  private state: UiState = {
    transcript: [], streaming: '', reasoning: '', reasoningStartedAt: null, status: 'idle', pendingPrompt: null, meta: null, activeTool: null,
    themeName: 'neon', pendingChoice: null, usage: { inputTokens: 0, outputTokens: 0 }, turnStartedAt: null,
    update: null, quota: null,
  };
  private listeners = new Set<() => void>();
  private resolver: ((answer: string) => void) | null = null;
  private choiceResolver: ((result: ChoiceResult) => void) | null = null;
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
    // Flush any completed markdown blocks into scrollback so the live frame stays short — this is
    // what keeps the input pinned near the bottom during long turns (see App). Only the trailing
    // incomplete block re-renders in place; finished paragraphs/fences become <Static> history.
    const buf = this.state.streaming + delta;
    const { committed, rest } = splitStreamable(buf);
    if (committed.trim()) {
      this.set({
        transcript: [...this.state.transcript, { kind: 'assistant', text: committed.trimEnd() }],
        streaming: rest,
      });
    } else {
      this.set({ streaming: buf });
    }
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

  setUpdate = (update: UpdateInfo): void => { this.set({ update }); };

  setQuota = (quota: QuotaSummary): void => { this.set({ quota }); };

  addUsage = (inputTokens: number, outputTokens: number): void => {
    this.set({
      usage: {
        inputTokens: this.state.usage.inputTokens + inputTokens,
        outputTokens: this.state.usage.outputTokens + outputTokens,
      },
    });
  };

  // Interactive picker: returns the chosen option, or null if cancelled (Esc).
  requestChoice = (spec: PromptSpec): Promise<ChoiceResult> =>
    new Promise((resolve) => { this.choiceResolver = resolve; this.set({ pendingChoice: spec }); });

  resolveChoice = (result: ChoiceResult): void => {
    const r = this.choiceResolver;
    this.choiceResolver = null;
    this.set({ pendingChoice: null });
    r?.(result);
  };

  // Ask a free-form question with optional quick-pick suggestions; always resolves to a string
  // (typed text, the picked suggestion, or '' if cancelled).
  requestAsk = async (question: string, options: string[] = []): Promise<string> => {
    const opts: ChoiceOption[] = [
      ...options.map((o) => ({ label: o, value: o })),
      { label: '✎ type my own answer…', value: '__free__', opensInput: true, inputPlaceholder: 'your answer' },
    ];
    const result = await this.requestChoice({ title: question, options: opts });
    if (result === null) return '';
    return result.value === '__free__' ? (result.text ?? '') : result.value;
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
