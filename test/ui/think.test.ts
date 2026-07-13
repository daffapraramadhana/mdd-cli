import { describe, it, expect } from 'vitest';
import { ThinkSplitter } from '../../src/ui/think.js';

function run(chunks: string[]): string {
  const s = new ThinkSplitter();
  let out = '';
  for (const c of chunks) out += s.push(c);
  out += s.flush();
  return out;
}

describe('ThinkSplitter', () => {
  it('passes plain text through unchanged', () => {
    expect(run(['hello world'])).toBe('hello world');
  });

  it('drops a complete <think> block', () => {
    expect(run(['a<think>secret</think>b'])).toBe('ab');
  });

  it('drops an empty <think></think> block', () => {
    expect(run(['<think></think>ok'])).toBe('ok');
  });

  it('handles a tag split across chunks', () => {
    // "<thi" | "nk>hidden</thi" | "nk>done"
    expect(run(['<thi', 'nk>hidden</thi', 'nk>done'])).toBe('done');
  });

  it('handles think content arriving in many small chunks', () => {
    expect(run(['before ', '<think>', 'a', 'b', 'c', '</think>', ' after'])).toBe('before  after');
  });

  it('keeps a literal < that is not a think tag', () => {
    expect(run(['x < y and <div>'])).toBe('x < y and <div>');
  });

  it('drops an unterminated think block at end of stream', () => {
    expect(run(['visible<think>still thinking'])).toBe('visible');
  });
});
