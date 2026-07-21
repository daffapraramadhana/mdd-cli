import type { Message } from '../types.js';

export const DEFAULT_CONTEXT_LIMIT = 1_000_000;
export const COMPACT_RATIO = 0.8;

// Per-model context windows. Every model currently served (Claude + GPT via 9router)
// is 1M, so the map is a placeholder for future exceptions; unknown ids fall back to
// the default. `--model` accepts any string, so a fallback is mandatory.
const CONTEXT_LIMITS: Record<string, number> = {};

export function contextLimit(model: string): number {
  return CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

// True when the last request's real prompt size crossed `ratio` of the model's window.
// Strict greater-than so the boundary value itself does not trigger.
export function shouldCompact(lastInputTokens: number, model: string, ratio = COMPACT_RATIO): boolean {
  return lastInputTokens > contextLimit(model) * ratio;
}
