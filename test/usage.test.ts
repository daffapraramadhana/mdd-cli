import { describe, it, expect } from 'vitest';
import { formatTokens, estimateCost, formatUsage } from '../src/usage.js';

describe('formatTokens', () => {
  it('shows raw counts under 1k and k above', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12345)).toBe('12.3k');
    expect(formatTokens(2000)).toBe('2k');
  });
});

describe('estimateCost', () => {
  it('prices known models and maps cc/ to the underlying Claude tier', () => {
    // sonnet: $3 in / $15 out per 1M
    expect(estimateCost('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3);
    expect(estimateCost('cc/claude-sonnet-5', { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(15);
  });
  it('returns null for unknown models', () => {
    expect(estimateCost('cc/claude-fable-5', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
    expect(estimateCost('mystery', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });
});

describe('formatUsage', () => {
  it('renders tokens + estimated cost for a known model', () => {
    const s = formatUsage({ inputTokens: 12000, outputTokens: 3400 }, 'cc/claude-sonnet-5');
    expect(s).toContain('12k↑');
    expect(s).toContain('3.4k↓');
    expect(s).toMatch(/~\$/);
  });
  it('omits cost for an unknown model', () => {
    const s = formatUsage({ inputTokens: 100, outputTokens: 50 }, 'unknown');
    expect(s).toBe('100↑ 50↓');
  });
});
