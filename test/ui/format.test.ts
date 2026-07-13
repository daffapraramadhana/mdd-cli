import { describe, it, expect } from 'vitest';
import { formatToolCall, toolIcon } from '../../src/ui/format.js';
import { splitBlocks, parseInline } from '../../src/ui/markdown.js';

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

describe('splitBlocks', () => {
  it('separates fenced code blocks from text', () => {
    const blocks = splitBlocks('before\n```\ncode line\n```\nafter');
    expect(blocks).toEqual([
      { type: 'text', content: 'before' },
      { type: 'code', lines: ['code line'] },
      { type: 'text', content: 'after' },
    ]);
  });
  it('treats plain text as a single text block', () => {
    expect(splitBlocks('just text')).toEqual([{ type: 'text', content: 'just text' }]);
  });
});

describe('parseInline', () => {
  it('splits bold and inline code from plain runs', () => {
    expect(parseInline('a **b** c `d`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', code: true },
    ]);
  });
  it('returns a single empty token for an empty line', () => {
    expect(parseInline('')).toEqual([{ text: '' }]);
  });
});
