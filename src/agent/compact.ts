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

export const KEEP_EXCHANGES = 2;

// A genuine user turn: role 'user' with at least one text block. A user message that
// only carries tool_result blocks is the *middle* of an agent exchange, not a new turn.
function isUserPrompt(m: Message): boolean {
  return m.role === 'user' && m.content.some((b) => b.type === 'text');
}

// Split the history so the last `keepExchanges` real exchanges stay verbatim (tail) and
// everything before is summarizable (head). The boundary always lands on a user-prompt
// message, which guarantees no tool_use/tool_result pair is split across head/tail.
export function splitForCompaction(
  messages: Message[],
  keepExchanges = KEEP_EXCHANGES,
): { head: Message[]; tail: Message[] } {
  const promptIndices = messages.map((m, i) => (isUserPrompt(m) ? i : -1)).filter((i) => i >= 0);
  if (promptIndices.length <= keepExchanges) return { head: [], tail: messages };
  const boundary = promptIndices[promptIndices.length - keepExchanges];
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}
