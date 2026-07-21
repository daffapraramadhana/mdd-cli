import { describe, it, expect } from 'vitest';
import { contextLimit, shouldCompact, DEFAULT_CONTEXT_LIMIT, splitForCompaction } from '../../src/agent/compact.js';
import type { Message } from '../../src/types.js';

describe('contextLimit', () => {
  it('returns the default limit for a known 9router model', () => {
    expect(contextLimit('cc/claude-sonnet-5')).toBe(1_000_000);
  });
  it('falls back to the default for an unknown model id', () => {
    expect(contextLimit('some/unknown-model')).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('shouldCompact', () => {
  it('is false below the 80% threshold', () => {
    expect(shouldCompact(700_000, 'cc/claude-sonnet-5')).toBe(false);
  });
  it('is true above the 80% threshold', () => {
    expect(shouldCompact(850_000, 'cc/claude-sonnet-5')).toBe(true);
  });
  it('is false exactly at the threshold (strict greater-than)', () => {
    expect(shouldCompact(800_000, 'cc/claude-sonnet-5')).toBe(false);
  });
  it('honors a custom ratio', () => {
    expect(shouldCompact(500_000, 'cc/claude-sonnet-5', 0.4)).toBe(true);
  });
});

// A realistic interleaved history: two full agent exchanges. Each user prompt is a
// text message; tool results come back as user messages carrying tool_result blocks.
function sampleHistory(): Message[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'prompt A' }] },              // 0 exchange 1 start
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] }, // 1
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'file', isError: false }] }, // 2
    { role: 'assistant', content: [{ type: 'text', text: 'done A' }] },           // 3
    { role: 'user', content: [{ type: 'text', text: 'prompt B' }] },              // 4 exchange 2 start
    { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'read', input: {} }] }, // 5
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't2', content: 'file', isError: false }] }, // 6
    { role: 'assistant', content: [{ type: 'text', text: 'done B' }] },           // 7
    { role: 'user', content: [{ type: 'text', text: 'prompt C' }] },              // 8 exchange 3 start
    { role: 'assistant', content: [{ type: 'text', text: 'done C' }] },           // 9
  ];
}

describe('splitForCompaction', () => {
  it('keeps the last 2 real exchanges in the tail, summarizes the rest', () => {
    const { head, tail } = splitForCompaction(sampleHistory(), 2);
    // Exchange 1 (indices 0-3) goes to head; exchanges 2 and 3 (indices 4-9) to tail.
    expect(head).toHaveLength(4);
    expect(tail).toHaveLength(6);
    expect(tail[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'prompt B' }] });
  });

  it('never splits a tool_use from its tool_result across the boundary', () => {
    const { tail } = splitForCompaction(sampleHistory(), 2);
    // The tail must start on a genuine user-text prompt, so no orphan tool_result leads it.
    const firstBlock = tail[0].content[0];
    expect(firstBlock.type).toBe('text');
  });

  it('returns an empty head when there are not more than keepExchanges exchanges', () => {
    const short: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'only prompt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    ];
    const { head, tail } = splitForCompaction(short, 2);
    expect(head).toEqual([]);
    expect(tail).toEqual(short);
  });
});
