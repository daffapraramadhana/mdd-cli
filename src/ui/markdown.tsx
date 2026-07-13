// src/ui/markdown.tsx
// Thin Ink layer over the pure parser (markdown-parse.ts) and highlighter (highlight.ts).
// No parsing logic lives here — this file only maps blocks to Ink components with a
// balanced "immersive but clean" treatment: accent headings, highlighted code with a
// language tag, ordered/nested lists, blockquotes, dividers, links, and basic tables.
import { Box, Text, useStdout } from 'ink';
import type { InlineToken, ListItem, MdBlock, Align } from './markdown-parse.js';
import { parseBlocks } from './markdown-parse.js';
import { highlight, type HlPalette, type HlToken } from './highlight.js';
import type { Theme } from './theme.js';

const RULE_WIDTH = 48;
const BULLETS = ['•', '◦', '‣'];

function paletteFor(theme: Theme): HlPalette {
  return {
    keyword: theme.accent,
    string: theme.toolOk,
    comment: theme.toolRun,
    number: theme.user,
    fn: theme.assistant,
    base: theme.code,
  };
}

function renderTokens(tokens: InlineToken[], accent: string) {
  return tokens.map((t, i) => {
    if (t.href) {
      return (
        <Text key={i}>
          <Text color={accent} underline>{t.text}</Text>
          <Text dimColor>{` (${t.href})`}</Text>
        </Text>
      );
    }
    if (t.code) return <Text key={i} color="cyan">{t.text}</Text>;
    if (t.bold) return <Text key={i} bold>{t.text}</Text>;
    if (t.italic) return <Text key={i} italic>{t.text}</Text>;
    return <Text key={i}>{t.text}</Text>;
  });
}

/** Split highlighted tokens into per-visual-line runs, preserving newlines as line breaks. */
function hlLines(tokens: HlToken[]): HlToken[][] {
  const lines: HlToken[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, color: t.color });
    });
  }
  return lines;
}

function CodeBlock({ lang, lines, theme }: { lang: string | null; lines: string[]; theme: Theme }) {
  const tokens = highlight(lines.join('\n'), lang, paletteFor(theme));
  const rows = hlLines(tokens);
  return (
    <Box flexDirection="column" marginTop={1}>
      {lang ? (
        <Text><Text color={theme.accent}>❯ </Text><Text dimColor>{lang}</Text></Text>
      ) : null}
      <Box flexDirection="column" borderStyle="round" borderColor={theme.code} paddingX={1}>
        {(rows.length ? rows : [[]]).map((row, j) => (
          <Text key={j}>
            {row.length ? row.map((t, k) => <Text key={k} color={t.color}>{t.text}</Text>) : ' '}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

const cellText = (cell: InlineToken[] | undefined): string => (cell ?? []).map((t) => t.text).join('');
const justifyFor = (a: Align): 'flex-start' | 'center' | 'flex-end' =>
  a === 'right' ? 'flex-end' : a === 'center' ? 'center' : 'flex-start';

const TABLE_GAP = 2;
const TABLE_MIN_COL = 4;

/**
 * Column widths capped to `maxWidth`. When the whole table fits, every column keeps its natural
 * (longest-cell) width. When it doesn't, allocate by water-filling: columns narrower than the
 * fair share keep their natural width, and the freed space flows to the wide (prose) columns,
 * which then wrap *inside* their column. This avoids squishing narrow key columns.
 */
function columnWidths(block: Extract<MdBlock, { type: 'table' }>, maxWidth: number): number[] {
  const cols = block.header.length;
  const natural = Array.from({ length: cols }, (_, c) => {
    const cells = [block.header[c], ...block.rows.map((r) => r[c])];
    return Math.max(1, ...cells.map((cell) => cellText(cell).length));
  });
  const budget = Math.max(cols * TABLE_MIN_COL, maxWidth - TABLE_GAP * (cols - 1));
  if (natural.reduce((a, b) => a + b, 0) <= budget) return natural;

  const widths = new Array<number>(cols).fill(-1); // -1 = not yet assigned
  let remaining = budget;
  let unassigned = cols;
  for (let changed = true; changed && unassigned > 0; ) {
    changed = false;
    const share = Math.floor(remaining / unassigned);
    for (let c = 0; c < cols; c++) {
      if (widths[c] === -1 && natural[c] <= share) {
        widths[c] = natural[c];
        remaining -= natural[c];
        unassigned--;
        changed = true;
      }
    }
  }
  if (unassigned > 0) {
    const share = Math.max(TABLE_MIN_COL, Math.floor(remaining / unassigned));
    for (let c = 0; c < cols; c++) if (widths[c] === -1) widths[c] = share;
  }
  return widths;
}

function TableBlock({ block, theme, maxWidth }: { block: Extract<MdBlock, { type: 'table' }>; theme: Theme; maxWidth: number }) {
  const cols = block.header.length;
  const widths = columnWidths(block, maxWidth);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + TABLE_GAP * (cols - 1);

  const cell = (tokens: InlineToken[] | undefined, c: number, header: boolean) => (
    <Box key={c} width={widths[c]} marginRight={c < cols - 1 ? TABLE_GAP : 0} justifyContent={justifyFor(block.align[c] ?? 'left')}>
      <Text bold={header} color={header ? theme.accent : undefined} wrap="wrap">{cellText(tokens)}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>{block.header.map((h, c) => cell(h, c, true))}</Box>
      <Text dimColor>{'─'.repeat(Math.min(totalWidth, maxWidth))}</Text>
      {block.rows.map((row, r) => (
        <Box key={r}>{widths.map((_, c) => cell(row[c], c, false))}</Box>
      ))}
    </Box>
  );
}

function ListBlock({ items, accent }: { items: ListItem[]; accent: string }) {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Text key={i}>
          {'  '.repeat(it.depth)}
          <Text color={accent} dimColor={it.depth > 0}>
            {it.ordered ? `${it.marker} ` : `${BULLETS[Math.min(it.depth, BULLETS.length - 1)]} `}
          </Text>
          {renderTokens(it.tokens, accent)}
        </Text>
      ))}
    </Box>
  );
}

function Heading({ level, tokens, accent }: { level: number; tokens: InlineToken[]; accent: string }) {
  return (
    <Box marginTop={1}>
      <Text color={accent} bold dimColor={level >= 3}>{renderTokens(tokens, accent)}</Text>
    </Box>
  );
}

export function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const accent = theme.accent;
  const { stdout } = useStdout();
  // Leave room for the "MDD" gutter + a little breathing space so tables never hit the edge.
  const maxWidth = Math.max(24, (stdout?.columns ?? 80) - 8);
  const blocks = parseBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return <Heading key={i} level={b.level} tokens={b.tokens} accent={accent} />;
          case 'code':
            return <CodeBlock key={i} lang={b.lang} lines={b.lines} theme={theme} />;
          case 'list':
            return <ListBlock key={i} items={b.items} accent={accent} />;
          case 'divider':
            return <Text key={i} dimColor>{'─'.repeat(RULE_WIDTH)}</Text>;
          case 'table':
            return <TableBlock key={i} block={b} theme={theme} maxWidth={maxWidth} />;
          case 'blockquote':
            return (
              <Box key={i} flexDirection="column">
                {b.lines.map((line, j) => (
                  <Text key={j}>
                    <Text color={accent}>▎ </Text>
                    <Text dimColor>{renderTokens(line, accent)}</Text>
                  </Text>
                ))}
              </Box>
            );
          default: // paragraph
            return (
              <Box key={i} flexDirection="column">
                {b.lines.map((line, j) => <Text key={j}>{renderTokens(line, accent)}</Text>)}
              </Box>
            );
        }
      })}
    </Box>
  );
}
