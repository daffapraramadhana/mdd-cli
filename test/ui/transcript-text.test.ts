import { describe, it, expect } from 'vitest';
import { renderTranscriptText } from '../../src/ui/transcript-text.js';
import { getTheme } from '../../src/ui/theme.js';
import type { TranscriptItem } from '../../src/ui/store.js';

// Strip ANSI so we can assert on the plain content.
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderTranscriptText', () => {
  it('renders user/assistant/tool lines with labels, args, and timing', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', text: 'run the tests' },
      { kind: 'assistant', text: 'On it.' },
      { kind: 'tool', name: 'run_shell', input: { command: 'npm test' }, status: 'ok', durationMs: 42 },
      { kind: 'assistant', text: 'All pass.' },
    ];
    const out = plain(renderTranscriptText(items, getTheme('neon')));
    expect(out).toContain('You  run the tests  #1');
    expect(out).toContain('MDD  On it.');
    expect(out).toContain('✓ ❯ run_shell(npm test)  42ms');
    expect(out).toContain('MDD  All pass.');
  });

  it('indents wrapped assistant lines and marks failed tools', () => {
    const items: TranscriptItem[] = [
      { kind: 'assistant', text: 'line one\nline two' },
      { kind: 'tool', name: 'git', input: { args: 'push' }, status: 'error', durationMs: 5 },
    ];
    const out = plain(renderTranscriptText(items, getTheme('neon')));
    expect(out).toContain('MDD  line one');
    expect(out).toContain('     line two');
    expect(out).toContain('✗ ⎇ git(push)  5ms');
  });
});
