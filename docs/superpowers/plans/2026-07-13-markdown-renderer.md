# Immersive Markdown Renderer Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. TDD throughout.

**Goal:** Rebuild the terminal markdown renderer with a balanced immersive-but-clean look: accent headings, syntax-highlighted code, ordered/nested lists, blockquotes, dividers, links, and basic tables — rendered live during streaming.

**Architecture:** Split parsing (pure, `markdown-parse.ts`) from highlighting (pure, `highlight.ts`) from rendering (Ink, `markdown.tsx`). Wire streaming text through the renderer in `app.tsx`. Bring `transcript-text.ts` to cheap-win parity.

**Tech Stack:** TypeScript ESM, React 19 + Ink 6, vitest, ink-testing-library. Dependency-free (no highlight lib).

## Global Constraints

- No new runtime dependencies.
- Pure modules (`markdown-parse.ts`, `highlight.ts`) must not import React/Ink.
- Colors flow from the active `Theme` (`src/ui/theme.ts`); no hardcoded hex in the renderer where a theme value fits.
- Match existing file style: leading `// src/…` path comment, focused single-responsibility modules.

---

### Task 1: Parser — block tree + extended inline tokens

**Files:**
- Create: `src/ui/markdown-parse.ts`
- Test: `test/ui/markdown-parse.test.ts`

**Interfaces:**
- Produces:
  - `type InlineToken = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }`
  - `type Align = 'left' | 'center' | 'right'`
  - `type ListItem = { depth: number; ordered: boolean; marker: string; tokens: InlineToken[] }`
  - `type MdBlock = { type:'heading'; level:number; tokens:InlineToken[] } | { type:'paragraph'; lines:InlineToken[][] } | { type:'list'; items:ListItem[] } | { type:'code'; lang:string|null; lines:string[] } | { type:'blockquote'; lines:InlineToken[][] } | { type:'divider' } | { type:'table'; header:InlineToken[][]; align:Align[]; rows:InlineToken[][][] }`
  - `function parseBlocks(text: string): MdBlock[]`
  - `function parseInline(line: string): InlineToken[]`

Steps: write failing tests covering headings, paragraphs, unordered+ordered+nested lists, fenced code w/ lang, unclosed fence (reads to end), blockquote, `---` divider, table w/ alignment, stray-pipe-not-a-table, links `[t](u)`, `_italic_`, and an incomplete trailing `**`/`` ` `` degrading to literal. Implement parser to pass. Run `npx vitest run test/ui/markdown-parse.test.ts`.

### Task 2: Syntax highlighter

**Files:**
- Create: `src/ui/highlight.ts`
- Test: `test/ui/highlight.test.ts`

**Interfaces:**
- Consumes: theme palette (accent/string/comment/number hexes passed in as an arg object).
- Produces:
  - `type HlToken = { text: string; color?: string }`
  - `type HlPalette = { keyword:string; string:string; comment:string; number:string; fn:string; base:string }`
  - `function highlight(code: string, lang: string | null, palette: HlPalette): HlToken[]`

Lexers for `ts/js/tsx/jsx`, `json`, `sh/bash/shell`, `py/python`. Unknown/null lang → `[{ text: code, color: palette.base }]`. Never throws. Tests assert token classes per language + fallback + odd input safety. Run `npx vitest run test/ui/highlight.test.ts`.

### Task 3: Ink renderer

**Files:**
- Rewrite: `src/ui/markdown.tsx`
- Test: `test/ui/markdown.test.tsx`

**Interfaces:**
- Consumes: `parseBlocks`, `parseInline` (Task 1), `highlight` + `HlPalette` (Task 2), `Theme`.
- Produces: `function Markdown({ text, theme }: { text: string; theme: Theme }): JSX.Element` (theme replaces the old `codeColor`/`accent` props).

Derive `HlPalette` from `theme`. Render each block type per the spec visual treatment. Keep `splitBlocks`/`parseInline` export compatibility only if needed by callers — otherwise update callers. Render smoke test via ink-testing-library asserting substrings for heading, code, table, blockquote. Run `npx vitest run test/ui/markdown.test.tsx`.

### Task 4: Wire renderer + live streaming in app.tsx

**Files:**
- Modify: `src/ui/app.tsx` (Markdown call ~line 55; streaming Row ~line 127)
- Test: extend `test/ui/app.test.tsx`

Update `Markdown` usage to `theme={theme}`. Replace the plain-`<Text>` streaming body with `<Markdown text={state.streaming} theme={theme} />` followed by the blinking cursor. Add app test asserting streaming markdown formats live. Run `npx vitest run test/ui/app.test.tsx`.

### Task 5: transcript-text cheap-win parity

**Files:**
- Modify: `src/ui/transcript-text.ts`
- Test: extend `test/ui/transcript-text.test.ts`

Reuse `parseBlocks` to emit ANSI for headings (accent), ordered/unordered lists, blockquotes (`▎`), dividers. Code blocks stay indented gray; no highlighting/tables. Run `npx vitest run test/ui/transcript-text.test.ts`.

### Task 6: Full suite + build

Run `npx vitest run` and `npm run build`. Fix fallout.
