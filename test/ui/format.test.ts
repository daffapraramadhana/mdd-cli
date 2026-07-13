import { describe, it, expect } from 'vitest';
import { formatToolCall, toolIcon, summarizePreview } from '../../src/ui/format.js';

describe('formatToolCall', () => {
  it('shows the path for file/dir tools', () => {
    expect(formatToolCall('read_file', { path: 'package.json' })).toBe('read_file(package.json)');
    expect(formatToolCall('list_dir', { path: '.' })).toBe('list_dir(.)');
  });
  it('shows the command for run_shell and args for git', () => {
    expect(formatToolCall('run_shell', { command: 'npm test' })).toBe('run_shell(npm test)');
    expect(formatToolCall('git', { args: 'status --short' })).toBe('git(status --short)');
  });
  it('collapses whitespace and truncates long args', () => {
    const out = formatToolCall('run_shell', { command: 'echo ' + 'x'.repeat(100) });
    expect(out.length).toBeLessThanOrEqual('run_shell('.length + 60 + 1);
    expect(out.endsWith('…)')).toBe(true);
  });
  it('falls back to JSON for unknown tools', () => {
    expect(formatToolCall('weird', { a: 1 })).toBe('weird({"a":1})');
  });
});

describe('toolIcon', () => {
  it('maps known tools to glyphs and falls back to a dot', () => {
    expect(toolIcon('read_file')).toBe('▤');
    expect(toolIcon('run_shell')).toBe('❯');
    expect(toolIcon('git')).toBe('⎇');
    expect(toolIcon('mystery')).toBe('•');
  });
});

describe('summarizePreview', () => {
  it('summarizes read_file as line count + human size', () => {
    const body = Array.from({ length: 42 }, () => 'x').join('\n'); // 42 lines
    expect(summarizePreview('read_file', body, false)).toBe('42 lines · 83 B');
  });
  it('uses KB for larger reads', () => {
    const body = 'a'.repeat(2048);
    expect(summarizePreview('read_file', body, false)).toBe('1 lines · 2.0 KB');
  });
  it('summarizes list_dir as entry count, ignoring the (empty) sentinel', () => {
    expect(summarizePreview('list_dir', 'a.ts\nb.ts\nc.ts', false)).toBe('3 entries');
    expect(summarizePreview('list_dir', '(empty)', false)).toBe('empty');
  });
  it('summarizes search as match count', () => {
    expect(summarizePreview('search', 'src/a.ts:1: hit\nsrc/b.ts:9: hit', false)).toBe('2 matches');
    expect(summarizePreview('search', '(no matches)', false)).toBe('no matches');
  });
  it('summarizes run_shell as the first non-empty output line, truncated', () => {
    expect(summarizePreview('run_shell', '\n  42 passing\n1 pending', false)).toBe('42 passing');
    const long = 'x'.repeat(80);
    expect(summarizePreview('run_shell', long, false)).toBe('x'.repeat(57) + '…');
  });
  it('summarizes write_file as human size written', () => {
    expect(summarizePreview('write_file', 'Wrote 2048 bytes to a.ts', false)).toBe('wrote 2.0 KB');
  });
  it('summarizes multi_edit as edit count', () => {
    expect(summarizePreview('multi_edit', 'Applied 3 edit(s) to a.ts', false)).toBe('3 edits');
  });
  it('returns undefined for edit_file success (no useful extra fact)', () => {
    expect(summarizePreview('edit_file', 'Edited a.ts', false)).toBeUndefined();
  });
  it('returns undefined when content is missing', () => {
    expect(summarizePreview('read_file', undefined, false)).toBeUndefined();
  });
  it('shows the first line of an error, truncated', () => {
    expect(summarizePreview('run_shell', 'exit code 1\nboom', true)).toBe('exit code 1');
  });
});
