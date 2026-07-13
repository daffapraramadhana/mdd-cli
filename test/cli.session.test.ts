import { describe, it, expect } from 'vitest';
import { relativeTime, sessionOptionLabel } from '../src/cli.js';
import type { SessionSummary } from '../src/session.js';

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('"just now" for < 1 minute', () => {
    expect(relativeTime(now - 30_000, now)).toBe('just now');
  });
  it('minutes', () => {
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3m ago');
  });
  it('hours', () => {
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2h ago');
  });
  it('days', () => {
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3d ago');
  });
});

describe('sessionOptionLabel', () => {
  const now = 1_000_000_000_000;
  const summary: SessionSummary = {
    id: 's1',
    title: 'fix the parser',
    updatedAt: now - 5 * 60_000,
    model: 'claude-opus-4-8',
    messageCount: 4,
  };

  it('formats title · relative time · message count', () => {
    const label = sessionOptionLabel(summary, now);
    expect(label).toContain('fix the parser');
    expect(label).toContain('5m ago');
    expect(label).toContain('4 msgs');
  });

  it('handles a single message (still "msgs" is fine but count shows)', () => {
    const label = sessionOptionLabel({ ...summary, messageCount: 1 }, now);
    expect(label).toContain('1 msg');
  });
});
