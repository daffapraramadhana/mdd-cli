import { describe, it, expect } from 'vitest';
import { formatBanner, formatStatus, formatPath, shortenCwd } from '../../src/ui/banner.js';

describe('formatBanner', () => {
  it('renders the big ASCII logo, the subtitle, and the version', () => {
    const b = formatBanner({ version: '0.1.0' });
    expect(b).toContain('█'); // block-art letters
    expect(b).toContain('terminal coding assistant');
    expect(b).toContain('v0.1.0');
  });

  it('renders the logo as 6 art rows plus a subtitle line', () => {
    const lines = formatBanner({ version: '9.9.9' }).split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain('█');
    expect(lines[4]).toContain('█');
    expect(lines[6]).toContain('v9.9.9');
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

const base = { provider: 'openai', model: 'gpt-x', cwd: '~/p' };

describe('formatStatus — mode', () => {
  it('shows the mode label in normal mode', () => {
    expect(formatStatus({ ...base, mode: 'normal' })).toBe('openai · gpt-x · normal');
  });

  it('shows plan mode', () => {
    expect(formatStatus({ ...base, mode: 'plan' })).toContain('plan');
  });

  it('shows auto-accept edits mode', () => {
    expect(formatStatus({ ...base, mode: 'auto-edit' })).toContain('auto-accept edits');
  });
});
