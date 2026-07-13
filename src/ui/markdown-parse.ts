// src/ui/markdown-parse.ts
// Pure markdown parsing: raw text -> block tree + inline tokens. No React/Ink here,
// so it stays trivially testable and reusable by both the live renderer and the
// exit-scrollback ANSI dump. Not a full CommonMark engine — just the shapes this
// assistant actually emits.

export interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export type Align = 'left' | 'center' | 'right';

export interface ListItem {
  depth: number;
  ordered: boolean;
  marker: string; // e.g. "•" for unordered, "1." for ordered
  tokens: InlineToken[];
}

export type MdBlock =
  | { type: 'heading'; level: number; tokens: InlineToken[] }
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'code'; lang: string | null; lines: string[] }
  | { type: 'blockquote'; lines: InlineToken[][] }
  | { type: 'divider' }
  | { type: 'table'; header: InlineToken[][]; align: Align[]; rows: InlineToken[][][] };

// Order matters: links and bold are tried before single-char italic so `**` isn't
// mistaken for two `*` italics. Every alternative requires a closing marker, so an
// unterminated `**foo` simply doesn't match and falls through to literal text.
const INLINE_RE = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_|\*([^*\s][^*]*)\*/g;

/** Tokenize a single line into plain / bold / italic / code / link runs. */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ text: m[1], href: m[2] });
    else if (m[3] !== undefined) tokens.push({ text: m[3], bold: true });
    else if (m[4] !== undefined) tokens.push({ text: m[4], code: true });
    else if (m[5] !== undefined) tokens.push({ text: m[5], italic: true });
    else if (m[6] !== undefined) tokens.push({ text: m[6], italic: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  if (tokens.length === 0) tokens.push({ text: '' });
  return tokens;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const DIVIDER_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```(.*)$/;

/** A `| ... |` cell row split into trimmed cell strings. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** True when a line is a table separator like `| --- | :--: |`. */
function isSeparatorRow(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false;
  return splitRow(line).every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(':');
  const r = cell.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  return 'left';
}

/** Parse `text` into a flat list of block-level nodes. */
export function parseBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  const flushParagraph = (buf: string[]): void => {
    if (buf.length) out.push({ type: 'paragraph', lines: buf.map(parseInline) });
  };

  let para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code — capture optional language; an unclosed fence reads to EOF.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph(para); para = [];
      const lang = fence[1].trim() || null;
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++; // consume closing fence (no-op if we hit EOF)
      out.push({ type: 'code', lang, lines: code });
      continue;
    }

    if (line.trim() === '') { flushParagraph(para); para = []; i++; continue; }

    if (DIVIDER_RE.test(line)) { flushParagraph(para); para = []; out.push({ type: 'divider' }); i++; continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph(para); para = [];
      out.push({ type: 'heading', level: heading[1].length, tokens: parseInline(heading[2]) });
      i++; continue;
    }

    // Table: a pipe row immediately followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushParagraph(para); para = [];
      const header = splitRow(line).map(parseInline);
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: InlineToken[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      out.push({ type: 'table', header, align, rows });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushParagraph(para); para = [];
      const qlines: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        qlines.push(QUOTE_RE.exec(lines[i])![1]);
        i++;
      }
      out.push({ type: 'blockquote', lines: qlines.map(parseInline) });
      continue;
    }

    if (LIST_RE.test(line)) {
      flushParagraph(para); para = [];
      const items: ListItem[] = [];
      let base: boolean | null = null; // top-level ordered-ness; a change starts a new list
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const [, indent, mark, rest] = LIST_RE.exec(lines[i])!;
        const ordered = /\d+\./.test(mark);
        const depth = Math.floor(indent.length / 2);
        if (depth === 0) {
          if (base === null) base = ordered;
          else if (ordered !== base) break; // let the outer loop open a fresh list block
        }
        items.push({ depth, ordered, marker: ordered ? mark : '•', tokens: parseInline(rest) });
        i++;
      }
      out.push({ type: 'list', items });
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out;
}
