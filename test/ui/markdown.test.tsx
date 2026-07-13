import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Markdown } from '../../src/ui/markdown.js';
import { getTheme } from '../../src/ui/theme.js';

const theme = getTheme('neon');

describe('Markdown', () => {
  it('renders headings, highlighted code, blockquotes, and tables without markers', () => {
    const text = [
      '# Title',
      '',
      'A **bold** word and `inline`.',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '> a quote',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const { lastFrame } = render(<Markdown text={text} theme={theme} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Title');
    expect(frame).toContain('bold');
    expect(frame).toContain('inline');
    expect(frame).toContain('const x = 1;');
    expect(frame).toContain('ts'); // language label
    expect(frame).toContain('a quote');
    expect(frame).toContain('▎'); // blockquote bar
    // table content + header underline rule
    expect(frame).toContain('1');
    expect(frame).toContain('2');
    expect(frame).toContain('─'); // header rule under the table
    // no raw markdown markers leak through
    expect(frame).not.toContain('**');
    expect(frame).not.toContain('```');
  });

  it('renders ordered, nested lists and links', () => {
    const text = '1. first\n2. second\n   - nested\n\nSee [docs](https://x.dev).';
    const { lastFrame } = render(<Markdown text={text} theme={theme} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1. first');
    expect(frame).toContain('2. second');
    expect(frame).toContain('nested');
    expect(frame).toContain('docs');
    expect(frame).toContain('https://x.dev');
  });

  it('renders a horizontal rule for ---', () => {
    const { lastFrame } = render(<Markdown text={'above\n\n---\n\nbelow'} theme={theme} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('─');
    expect(frame).toContain('above');
    expect(frame).toContain('below');
  });
});
