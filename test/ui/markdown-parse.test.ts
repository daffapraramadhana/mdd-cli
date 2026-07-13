import { describe, it, expect } from 'vitest';
import { parseBlocks, parseInline } from '../../src/ui/markdown-parse.js';

describe('parseInline', () => {
  it('splits bold and inline code from plain runs', () => {
    expect(parseInline('a **b** c `d`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', code: true },
    ]);
  });
  it('parses italic (underscore and star)', () => {
    expect(parseInline('_a_ and *b*')).toEqual([
      { text: 'a', italic: true },
      { text: ' and ' },
      { text: 'b', italic: true },
    ]);
  });
  it('parses links into text + href', () => {
    expect(parseInline('see [docs](https://x.dev) ok')).toEqual([
      { text: 'see ' },
      { text: 'docs', href: 'https://x.dev' },
      { text: ' ok' },
    ]);
  });
  it('leaves an incomplete trailing marker as literal text', () => {
    expect(parseInline('done **half')).toEqual([{ text: 'done **half' }]);
  });
  it('returns a single empty token for an empty line', () => {
    expect(parseInline('')).toEqual([{ text: '' }]);
  });
});

describe('parseBlocks', () => {
  it('parses ATX headings with level', () => {
    const b = parseBlocks('# Title\n## Sub');
    expect(b[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(b[1]).toMatchObject({ type: 'heading', level: 2 });
    expect(b[0].type === 'heading' && b[0].tokens[0].text).toBe('Title');
  });

  it('captures a fenced code block with its language', () => {
    const b = parseBlocks('```ts\nconst x = 1;\n```');
    expect(b[0]).toEqual({ type: 'code', lang: 'ts', lines: ['const x = 1;'] });
  });

  it('reads an unclosed fence to end of input (streaming safe)', () => {
    const b = parseBlocks('```js\nlet y = 2;\nlet z = 3;');
    expect(b[0]).toEqual({ type: 'code', lang: 'js', lines: ['let y = 2;', 'let z = 3;'] });
  });

  it('parses ordered, unordered, and nested list items', () => {
    const b = parseBlocks('- one\n- two\n  - nested\n1. first\n2. second');
    const lists = b.filter((x) => x.type === 'list');
    expect(lists).toHaveLength(2);
    const ul = lists[0];
    const ol = lists[1];
    if (ul.type !== 'list' || ol.type !== 'list') throw new Error('expected lists');
    expect(ul.items[0]).toMatchObject({ depth: 0, ordered: false });
    expect(ul.items[2]).toMatchObject({ depth: 1, ordered: false });
    expect(ol.items[0]).toMatchObject({ depth: 0, ordered: true, marker: '1.' });
  });

  it('parses a blockquote', () => {
    const b = parseBlocks('> quoted line\n> more');
    expect(b[0].type).toBe('blockquote');
    if (b[0].type === 'blockquote') expect(b[0].lines).toHaveLength(2);
  });

  it('parses a divider', () => {
    expect(parseBlocks('above\n\n---\n\nbelow')[1]).toEqual({ type: 'divider' });
  });

  it('parses a table with alignment', () => {
    const b = parseBlocks('| a | b | c |\n| :-- | :--: | --: |\n| 1 | 2 | 3 |');
    expect(b[0].type).toBe('table');
    if (b[0].type !== 'table') throw new Error('expected table');
    expect(b[0].align).toEqual(['left', 'center', 'right']);
    expect(b[0].header.map((c) => c[0].text)).toEqual(['a', 'b', 'c']);
    expect(b[0].rows).toHaveLength(1);
  });

  it('treats a pipe line without a separator row as a paragraph', () => {
    const b = parseBlocks('a | b | c');
    expect(b[0].type).toBe('paragraph');
  });
});
