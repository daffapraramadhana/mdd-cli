# Immersive-but-clean Markdown Renderer — Design

**Date:** 2026-07-13
**Status:** Approved for planning
**Area:** `src/ui/` (markdown rendering)

## Problem

The live markdown renderer (`src/ui/markdown.tsx`) is minimal. It handles fenced
code blocks, inline code, `**bold**`, ATX headings, and single-level bullets —
everything else is dropped or rendered flat:

- Headings have no visual hierarchy (bold only, no color, no spacing).
- Code blocks are a flat gray border with gray text — no syntax color, no language label.
- No ordered lists, no nested lists, no blockquotes, no horizontal rules, no links, no tables.
- Streaming text (`app.tsx:127`) is rendered as **plain `<Text>`** and only "snaps"
  into formatted markdown once the assistant message commits.
- The exit scrollback dump (`src/ui/transcript-text.ts`) does **no** markdown at all.

Goal: a **balanced** visual direction — clean typographic base with a few immersive
touches (accent headings, syntax-highlighted code, styled blockquotes/dividers/tables) —
without heavy background bars. Dependency-free, consistent with the project's
"focused renderer, not a full CommonMark engine" philosophy.

## Approach

Keep a hard split between **pure parsing** (testable, no React) and **Ink rendering**.
Today `markdown.tsx` mixes both; we restructure into three modules.

### Modules

**`src/ui/markdown-parse.ts`** (pure, no React)
Turns raw text into a block tree `MdBlock[]`:

```ts
type MdBlock =
  | { type: 'heading'; level: number; tokens: InlineToken[] }
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }   // items carry depth + tokens
  | { type: 'code'; lang: string | null; lines: string[] }
  | { type: 'blockquote'; lines: InlineToken[][] }
  | { type: 'divider' }
  | { type: 'table'; header: InlineToken[][]; align: Align[]; rows: InlineToken[][][] };

type ListItem = { depth: number; ordered: boolean; marker: string; tokens: InlineToken[] };
type Align = 'left' | 'center' | 'right';
```

Inline tokenizer extended from the current `parseInline`:
`**bold**`, `` `code` ``, `_italic_` / `*italic*`, and `[text](url)` links.

Parsing rules / edge cases:
- Fenced code captures an optional language after the opening fence (```` ```ts ````).
- An **unclosed** fence reads to end of input (already the current behavior) — needed
  so streaming mid-code-block still renders as a code block.
- List nesting derived from leading-space count (2 spaces = 1 depth level).
- Table = a header row `| a | b |`, a separator row `| --- | :--: |` (drives alignment),
  then zero or more body rows. A `|` line **without** a following separator row is treated
  as a normal paragraph (not a table), so stray pipes don't misparse.
- Trailing incomplete inline markers while streaming (a lone `**` or `` ` `` with no closer)
  degrade to literal text rather than consuming the rest of the line.

**`src/ui/highlight.ts`** (pure, dependency-free)
`highlight(code: string, lang: string | null): HlToken[]` where
`HlToken = { text: string; color?: string }`. Regex-based lexers for the languages that
actually appear in this assistant's output:

- `ts` / `js` / `tsx` / `jsx` — keywords, strings, numbers, comments, function names.
- `json` — keys, strings, numbers, literals (`true`/`false`/`null`).
- `sh` / `bash` / `shell` — comments, strings, flags, common builtins.
- `py` / `python` — keywords, strings, numbers, comments, decorators.
- Unknown / null language → single quiet-gray token (current look). Graceful fallback,
  never throws.

Colors come from a small palette derived from the active `Theme` (accent for keywords,
a warm tone for strings, dim for comments) so highlighting respects theme choice.

**`src/ui/markdown.tsx`** (thin Ink layer)
Consumes the block tree + highlighter, maps to `<Box>`/`<Text>`. No parsing logic remains
here. Visual treatment (balanced):

- **Headings** — accent color + bold; `#` bright accent, `##`+ dimmer accent; blank line above.
- **Code blocks** — rounded border kept; language label rendered on the top border
  (e.g. `─ ts ─`); contents syntax-highlighted via `highlight.ts`.
- **Inline code** — cyan chip (kept).
- **Lists** — ordered items show accent-colored numbers; nested bullets indent by depth
  with a dimming marker ramp (`•` → `◦` → `‣`).
- **Blockquotes** — accent `▎` bar in the gutter, dimmed text.
- **Dividers** (`---`) — dim full-width rule.
- **Links** — `text` in accent + underline, followed by dimmed `(url)`.
- **Tables** — columns width-fit to content; header row bold/accent; dim rule under header;
  cell alignment honored from the separator row.

### Live streaming

Route `state.streaming` in `app.tsx` (currently line ~127) through the same `Markdown`
component instead of a plain `<Text>`, so formatting appears as text arrives. The blinking
cursor stays appended after the rendered content. Relies on the parser's tolerance for
unclosed fences and incomplete inline markers.

### Exit scrollback (`transcript-text.ts`)

Bring the ANSI dump to **parity for the cheap wins** only: headings (accent), bullets/ordered
lists, blockquotes (`▎` bar), and dividers, emitted as ANSI escape strings reusing the same
parser. **No** syntax highlighting or table layout there — it is a plain history dump, not the
live view. Code blocks stay as-is (indented gray).

## Scope

**In:** the three modules above, live-streaming wiring, transcript-text cheap-win parity,
basic tables, tests.

**Out (YAGNI):** nested/complex tables, task-list checkboxes, images, footnotes, HTML
passthrough, syntax highlighting inside the scrollback dump.

## Testing

- `test/ui/markdown-parse.test.ts` — every block type; list nesting; ordered vs unordered;
  links & italics; table parse + alignment; stray-pipe-not-a-table; unclosed fence;
  incomplete trailing inline marker.
- `test/ui/highlight.test.ts` — each supported language produces expected token classes;
  unknown language falls back to a single gray token; never throws on odd input.
- `test/ui/markdown.test.tsx` — `ink-testing-library` render smoke test (like `app.test.tsx`):
  headings, a highlighted code block, a table, and a blockquote render without error and
  contain expected substrings.

## Risks

- **Regex highlighters are approximate** — they won't be a real lexer. Acceptable: the
  fallback is "quiet gray," so a mis-tokenization degrades to plain, never to garbage.
- **Table width in narrow terminals** — fit to content but cap to terminal width; long cells
  wrap or truncate. Kept simple; revisit only if it looks bad.
- **Streaming re-parse cost** — parsing runs on every streamed chunk. The parser is O(n) over
  a single message's text; fine for assistant-length messages.
