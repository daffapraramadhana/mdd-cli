import { describe, it, expect } from 'vitest';
import { ThinkSplitter } from '../../src/ui/think.js';

function run(chunks: string[]): { visible: string; thinking: string } {
  const s = new ThinkSplitter();
  let visible = '';
  let thinking = '';
  for (const c of chunks) {
    const r = s.push(c);
    visible += r.visible;
    thinking += r.thinking;
  }
  const f = s.flush();
  return { visible: visible + f.visible, thinking: thinking + f.thinking };
}

describe('ThinkSplitter', () => {
  it('passes plain text through unchanged with no thinking', () => {
    expect(run(['hello world'])).toEqual({ visible: 'hello world', thinking: '' });
  });

  it('separates a complete <think> block from visible text', () => {
    expect(run(['a<think>secret</think>b'])).toEqual({ visible: 'ab', thinking: 'secret' });
  });

  it('yields empty thinking for an empty <think></think> block', () => {
    expect(run(['<think></think>ok'])).toEqual({ visible: 'ok', thinking: '' });
  });

  it('handles a tag split across chunks', () => {
    // "<thi" | "nk>hidden</thi" | "nk>done"
    expect(run(['<thi', 'nk>hidden</thi', 'nk>done'])).toEqual({ visible: 'done', thinking: 'hidden' });
  });

  it('accumulates think content arriving in many small chunks', () => {
    expect(run(['before ', '<think>', 'a', 'b', 'c', '</think>', ' after']))
      .toEqual({ visible: 'before  after', thinking: 'abc' });
  });

  it('keeps a literal < that is not a think tag', () => {
    expect(run(['x < y and <div>'])).toEqual({ visible: 'x < y and <div>', thinking: '' });
  });

  it('surfaces an unterminated think block at end of stream', () => {
    expect(run(['visible<think>still thinking']))
      .toEqual({ visible: 'visible', thinking: 'still thinking' });
  });
});
