import type { Message, ContentBlock } from '../types.js';

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
// Invariant this boundary safety relies on: a user message is never constructed with
// BOTH a text block and a tool_result block (pure prompt OR pure tool_result), so a
// tool_result is never split from its tool_use across the head/tail boundary.
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

export const TOOL_RESULT_KEEP = 1000;
export const SUMMARY_INSTRUCTION =
  'Summarize the conversation so far as a concise, factual briefing for continuing the ' +
  'task. Capture: the user\'s goals and constraints, key decisions, files and code touched, ' +
  'important findings from tool results, and any unresolved next steps. Be specific about ' +
  'names and paths. Do not add commentary — this summary replaces the earlier messages.';

export const SUMMARY_SYSTEM =
  'You are a summarization engine for a coding assistant. Produce a dense, factual ' +
  'summary of the conversation that preserves everything needed to continue the work. ' +
  'Output only the summary text.';

// Truncate a long string keeping the head and tail, eliding the middle.
function elide(s: string, keep: number): string {
  if (s.length <= keep * 2) return s;
  const removed = s.length - keep * 2;
  return `${s.slice(0, keep)}\n… [${removed} chars elided] …\n${s.slice(-keep)}`;
}

// Shrink one block: cap tool_result and text content, drop images, pass everything else
// through.
function shrinkBlock(b: ContentBlock): ContentBlock | null {
  if (b.type === 'image') return null;
  if (b.type === 'tool_result') return { ...b, content: elide(b.content, TOOL_RESULT_KEEP) };
  if (b.type === 'text') return { ...b, text: elide(b.text, TOOL_RESULT_KEEP) };
  return b;
}

// Build the summarization request from the head. Tool-result and text bulk is bounded
// and images are dropped, which keeps the request small in practice — even when
// compaction is invoked from an already-maxed conversation. If shrinking leaves a
// message with no content (e.g. an image-only prompt), a placeholder text block is
// substituted so the message APIs never see an empty content array. A trailing user
// instruction asks for the summary; because `head` ends on an assistant message,
// appending a user message keeps roles alternating.
export function summaryInput(head: Message[]): Message[] {
  const shrunk: Message[] = head.map((m) => {
    const content = m.content.map(shrinkBlock).filter((b): b is ContentBlock => b !== null);
    return {
      role: m.role,
      content: content.length > 0 ? content : [{ type: 'text', text: '[image omitted]' }],
    };
  });
  return [...shrunk, { role: 'user', content: [{ type: 'text', text: SUMMARY_INSTRUCTION }] }];
}

export const SUMMARY_ACK =
  'Understood. I have the summary of the earlier conversation above and will continue from here.';

// Assemble the compacted history: the summary as a user message, a synthetic assistant
// ack, then the verbatim tail. The tail must begin with a user message (as
// splitForCompaction guarantees) so roles alternate across the seam.
export function buildCompacted(summaryText: string, tail: Message[]): Message[] {
  return [
    { role: 'user', content: [{ type: 'text', text: summaryText }] },
    { role: 'assistant', content: [{ type: 'text', text: SUMMARY_ACK }] },
    ...tail,
  ];
}
