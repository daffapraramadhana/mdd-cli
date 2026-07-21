import { describe, it, expect } from 'vitest';
import { contextLimit, shouldCompact, DEFAULT_CONTEXT_LIMIT } from '../../src/agent/compact.js';

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
