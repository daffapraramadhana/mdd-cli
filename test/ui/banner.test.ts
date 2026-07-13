import { describe, it, expect } from 'vitest';
import { formatBanner, formatStatus, formatPath, shortenCwd } from '../../src/ui/banner.js';

describe('formatBanner', () => {
  it('renders a boxed MDD header with the version', () => {
    const b = formatBanner({ version: '0.1.0' });
    expect(b).toContain('MDD');
    expect(b).toContain('v0.1.0');
    expect(b).toContain('╭');
    expect(b).toContain('╯');
  });

  it('produces top/mid/bottom borders of equal width', () => {
    const [top, mid, bot] = formatBanner({ version: '9.9.9' }).split('\n');
    expect(mid.length).toBe(top.length);
    expect(bot.length).toBe(top.length);
  });
});

describe('shortenCwd', () => {
  it('replaces a home prefix with ~', () => {
    expect(shortenCwd('/Users/x/proj', '/Users/x')).toBe('~/proj');
    expect(shortenCwd('/Users/x', '/Users/x')).toBe('~');
  });
  it('leaves paths outside home untouched', () => {
    expect(shortenCwd('/tmp/work', '/Users/x')).toBe('/tmp/work');
    // must not match a partial prefix like /Users/xyz
    expect(shortenCwd('/Users/xyz/p', '/Users/x')).toBe('/Users/xyz/p');
  });
});

describe('formatStatus', () => {
  it('joins provider and model', () => {
    expect(formatStatus({ provider: 'openai', model: 'gpt-5', cwd: '~/p' })).toBe('openai · gpt-5');
  });
  it('appends auto-approve only when enabled', () => {
    expect(formatStatus({ provider: 'anthropic', model: 'claude-opus-4-8', cwd: '~/p', autoApprove: true }))
      .toBe('anthropic · claude-opus-4-8 · auto-approve');
    expect(formatStatus({ provider: 'anthropic', model: 'x', cwd: '~/p', autoApprove: false }))
      .not.toContain('auto-approve');
  });
});

describe('formatPath', () => {
  it('shows cwd alone when there is no branch', () => {
    expect(formatPath({ provider: 'openai', model: 'x', cwd: '~/proj' })).toBe('~/proj');
  });
  it('appends the branch in parentheses when present', () => {
    expect(formatPath({ provider: 'openai', model: 'x', cwd: '~/proj', branch: 'main' })).toBe('~/proj (main)');
  });
});
