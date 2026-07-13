# Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Read the spec first: `docs/superpowers/specs/2026-07-14-image-attachments-design.md`.

**Goal:** Let a user attach an image by dragging/pasting its file path into the prompt; it collapses to an `[Image #1: shot.png]` chip and is sent to the model as a base64 image block.

**Architecture:** A new `ImageBlock` content type flows through both providers (Anthropic base64 `source`, OpenAI `image_url` data URL). A pure `src/ui/attach.ts` detects image-file paths and formats chips; `app.tsx` shows chips and remembers paths; `cli.ts` reads+encodes the files at submit and builds the user message content.

**Tech Stack:** TypeScript ESM, `@anthropic-ai/sdk`, `openai`, React 19 + Ink 6, vitest. No new dependencies.

## Global Constraints

- No new runtime dependencies.
- `src/ui/attach.ts` must not import React/Ink/fs (the caller injects a file reader).
- Image extensions: `.png .jpg .jpeg .gif .webp`. `.jpg`/`.jpeg` → `image/jpeg`.
- Size cap: reject files larger than `MAX_IMAGE_BYTES = 5 * 1024 * 1024` (skip + system note).
- Chip format: `[Image #<n>: <basename>]`, numbering per composing buffer, resets on submit.
- Collapsed everywhere: chip in the input AND transcript; the model receives base64 image bytes.
- No change to `SessionRecord` / persistence shape (base64 rides inside `messages`).
- Detection fires only on a whole-chunk insert (drag/paste), never character-by-character.

---

### Task 1: `ImageBlock` in the message model + both provider mappings

**Files:**
- Modify: `src/types.ts`
- Modify: `src/providers/anthropic.ts` (export `toAnthropicMessages`, add image branch)
- Modify: `src/providers/openai.ts` (export `toOpenAIMessages`, add image array handling)
- Test: `test/providers/anthropic.test.ts`, `test/providers/openai.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ImageBlock { type: 'image'; mediaType: string; data: string }` in `src/types.ts`, added to the `ContentBlock` union. Exported `toAnthropicMessages(messages: Message[])` and `toOpenAIMessages(messages: Message[], systemPrompt: string)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/providers/anthropic.test.ts`:

```ts
import { toAnthropicMessages } from '../../src/providers/anthropic.js';
import type { Message } from '../../src/types.js';

describe('toAnthropicMessages image mapping', () => {
  it('maps an ImageBlock to a base64 image source alongside text', () => {
    const messages: Message[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', mediaType: 'image/png', data: 'QUJD' },
      ],
    }];
    expect(toAnthropicMessages(messages)).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
    }]);
  });
});
```

Append to `test/providers/openai.test.ts`:

```ts
import { toOpenAIMessages } from '../../src/providers/openai.js';
import type { Message } from '../../src/types.js';

describe('toOpenAIMessages image mapping', () => {
  it('builds an array content with an image_url data URL when images are present', () => {
    const messages: Message[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', mediaType: 'image/jpeg', data: 'QUJD' },
      ],
    }];
    const out = toOpenAIMessages(messages, 'sys');
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ],
    });
  });

  it('keeps a plain string content for text-only user messages', () => {
    const out = toOpenAIMessages([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], 'sys');
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/providers/anthropic.test.ts test/providers/openai.test.ts`
Expected: FAIL — `toAnthropicMessages`/`toOpenAIMessages` are not exported (import error), and image mapping is missing.

- [ ] **Step 3a: Add `ImageBlock` to `src/types.ts`**

Change:
```ts
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
```
to:
```ts
export interface ImageBlock { type: 'image'; mediaType: string; data: string; } // data = base64, no data: prefix
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;
```

- [ ] **Step 3b: Update `src/providers/anthropic.ts`**

Add `export` to the mapping function and handle the image block. Change:
```ts
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text' as const, text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
      return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
    }),
  }));
}
```
to:
```ts
export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text' as const, text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
      if (b.type === 'image') return { type: 'image' as const, source: { type: 'base64' as const, media_type: b.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: b.data } };
      return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
    }),
  }));
}
```

- [ ] **Step 3c: Update `src/providers/openai.ts`**

Export the mapping function and build array content when images are present. Change:
```ts
function toOpenAIMessages(messages: Message[], systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const toolUses = m.content.filter((b) => b.type === 'tool_use') as Array<{ id: string; name: string; input: unknown }>;
    const toolResults = m.content.filter((b) => b.type === 'tool_result') as Array<{ toolUseId: string; content: string }>;
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.length
          ? toolUses.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input) } }))
          : undefined,
      });
    } else {
      for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}
```
to:
```ts
export function toOpenAIMessages(messages: Message[], systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const toolUses = m.content.filter((b) => b.type === 'tool_use') as Array<{ id: string; name: string; input: unknown }>;
    const toolResults = m.content.filter((b) => b.type === 'tool_result') as Array<{ toolUseId: string; content: string }>;
    const images = m.content.filter((b) => b.type === 'image') as Array<{ mediaType: string; data: string }>;
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.length
          ? toolUses.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input) } }))
          : undefined,
      });
    } else {
      for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      if (images.length) {
        out.push({
          role: 'user',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
          ],
        });
      } else if (text) {
        out.push({ role: 'user', content: text });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run test/providers/anthropic.test.ts test/providers/openai.test.ts && npx tsc --noEmit`
Expected: all provider tests PASS; `tsc` clean (the union addition compiles because both providers now handle `image`).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/providers/anthropic.ts src/providers/openai.ts test/providers/anthropic.test.ts test/providers/openai.test.ts
git commit -m "feat(providers): ImageBlock content type mapped to Anthropic + OpenAI image inputs"
```

---

### Task 2: pure `src/ui/attach.ts` module

**Files:**
- Create: `src/ui/attach.ts`
- Test: `test/ui/attach.test.ts`

**Interfaces:**
- Consumes (Task 1): `ImageBlock` type from `src/types.ts`; `detectPaste` from `src/ui/paste.ts`.
- Produces: `IMAGE_EXTS`, `MAX_IMAGE_BYTES`, `AttachState`, `createAttachState`, `dequotePath`, `isImagePath`, `mediaTypeFor`, `imageLabel`, `stripImageTokens`, `detectImageInsert`, `attachImages`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/attach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  dequotePath, isImagePath, mediaTypeFor, imageLabel, stripImageTokens,
  detectImageInsert, attachImages, MAX_IMAGE_BYTES,
} from '../../src/ui/attach.js';

describe('dequotePath', () => {
  it('strips matching single/double quotes and unescapes "\\ "', () => {
    expect(dequotePath("'/a/b c.png'")).toBe('/a/b c.png');
    expect(dequotePath('"/a/b.png"')).toBe('/a/b.png');
    expect(dequotePath('/a/b\\ c.png')).toBe('/a/b c.png');
    expect(dequotePath('/a/b.png')).toBe('/a/b.png');
  });
});

describe('isImagePath', () => {
  it('accepts image extensions (any case) and rejects others', () => {
    expect(isImagePath('/x/y.png')).toBe(true);
    expect(isImagePath('/x/y.JPG')).toBe(true);
    expect(isImagePath('/x/y.jpeg')).toBe(true);
    expect(isImagePath('/x/y.webp')).toBe(true);
    expect(isImagePath('/x/y.txt')).toBe(false);
    expect(isImagePath('hello world')).toBe(false);
    expect(isImagePath('a.png\nb')).toBe(false); // multi-line chunk is not a path
  });
});

describe('mediaTypeFor', () => {
  it('maps extensions to media types (jpg and jpeg → image/jpeg)', () => {
    expect(mediaTypeFor('/a.png')).toBe('image/png');
    expect(mediaTypeFor('/a.jpg')).toBe('image/jpeg');
    expect(mediaTypeFor('/a.JPEG')).toBe('image/jpeg');
    expect(mediaTypeFor('/a.gif')).toBe('image/gif');
    expect(mediaTypeFor('/a.webp')).toBe('image/webp');
  });
});

describe('imageLabel', () => {
  it('formats a chip with the basename', () => {
    expect(imageLabel(1, '/Users/me/Desktop/shot.png')).toBe('[Image #1: shot.png]');
  });
});

describe('stripImageTokens', () => {
  it('removes every image token, leaving other text', () => {
    expect(stripImageTokens('look [Image #1: a.png] and [Image #2: b.jpg] ok')).toBe('look  and  ok');
    expect(stripImageTokens('no tokens')).toBe('no tokens');
  });
});

describe('detectImageInsert', () => {
  it('detects an inserted image path and returns its position + dequoted path', () => {
    expect(detectImageInsert('', "'/a/b c.png'")).toEqual({ path: '/a/b c.png', at: 0, len: "'/a/b c.png'".length });
    expect(detectImageInsert('hi ', 'hi /a/b.png')).toEqual({ path: '/a/b.png', at: 3, len: '/a/b.png'.length });
  });
  it('returns null when the insertion is not an image path', () => {
    expect(detectImageInsert('', 'just text')).toBeNull();
    expect(detectImageInsert('abc', 'ab')).toBeNull(); // deletion
  });
});

describe('attachImages', () => {
  it('encodes readable in-cap files and reports errors for oversize/unreadable', () => {
    const read = (p: string): Uint8Array => {
      if (p === '/ok.png') return new Uint8Array([65, 66, 67]);      // "ABC" → "QUJD"
      if (p === '/big.png') return new Uint8Array(MAX_IMAGE_BYTES + 1);
      throw new Error('ENOENT');
    };
    const { blocks, errors } = attachImages(['/ok.png', '/big.png', '/missing.png'], read);
    expect(blocks).toEqual([{ type: 'image', mediaType: 'image/png', data: 'QUJD' }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('big.png');
    expect(errors[1]).toContain('missing.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/attach.test.ts`
Expected: FAIL — `Cannot find module '../../src/ui/attach.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/attach.ts`:

```ts
// Pure image-attachment helpers for the prompt. No React/Ink/fs imports — the caller injects a
// file reader — so this is fully unit-testable. Detects an image-file path inserted as a chunk
// (drag/paste), formats the `[Image #n: name]` chip, and encodes files to base64 image blocks.
import { basename, extname } from 'node:path';
import type { ImageBlock } from '../types.js';
import { detectPaste } from './paste.js';

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AttachState { map: Map<number, string>; count: number; }
export function createAttachState(): AttachState { return { map: new Map(), count: 0 }; }

/** Strip matching surrounding quotes and unescape "\ " → " " (how terminals insert dragged paths). */
export function dequotePath(chunk: string): string {
  let s = chunk.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\ /g, ' ');
}

export function isImagePath(chunk: string): boolean {
  if (chunk.includes('\n')) return false;
  const lower = dequotePath(chunk).toLowerCase();
  return IMAGE_EXTS.some((e) => lower.endsWith(e));
}

export function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  return 'image/webp';
}

export function imageLabel(n: number, path: string): string {
  return `[Image #${n}: ${basename(path)}]`;
}

export function stripImageTokens(display: string): string {
  return display.replace(/\[Image #\d+: [^\]]*\]/g, '');
}

/** If the pure insertion prev→next is an image path, return its position + dequoted path. */
export function detectImageInsert(prev: string, next: string): { path: string; at: number; len: number } | null {
  const d = detectPaste(prev, next);
  if (!d) return null;
  if (!isImagePath(d.inserted.trim())) return null;
  return { path: dequotePath(d.inserted.trim()), at: d.at, len: d.inserted.length };
}

/** Read + base64-encode each path with an INJECTED reader. Oversize/unreadable → an error string. */
export function attachImages(
  paths: string[],
  read: (path: string) => Uint8Array,
): { blocks: ImageBlock[]; errors: string[] } {
  const blocks: ImageBlock[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    try {
      const bytes = read(p);
      if (bytes.length > MAX_IMAGE_BYTES) {
        errors.push(`could not attach ${basename(p)}: larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB`);
        continue;
      }
      blocks.push({ type: 'image', mediaType: mediaTypeFor(p), data: Buffer.from(bytes).toString('base64') });
    } catch (err) {
      errors.push(`could not attach ${basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { blocks, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ui/attach.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/attach.ts test/ui/attach.test.ts
git commit -m "feat(ui): pure image-attachment helpers (detect/label/strip/encode)"
```

---

### Task 3: wire attachments into the input and submit path

**Files:**
- Modify: `src/ui/app.tsx` (import attach helpers, `attachRef`, `SubmitInput.imagePaths`, `onChange` detection, `handleSubmit`)
- Modify: `src/cli.ts` (`repl()` `onSubmit` reads+encodes images, builds content)
- Test: `test/ui/app.test.tsx`

**Interfaces:**
- Consumes (Task 2): `createAttachState`, `detectImageInsert`, `imageLabel`, `stripImageTokens`, `attachImages`. (Task 1): `ImageBlock`.
- Produces: `SubmitInput` becomes `{ display: string; text: string; imagePaths: string[] }`.

- [ ] **Step 1: Write the failing test**

Add to `test/ui/app.test.tsx`, before the final `});` of the `describe('App', …)` block (it uses `waitForFrame` and `tick`, already defined in the file; add the node imports at the top of the file if missing):

```tsx
// at top of file (with the other imports):
// import { writeFileSync, rmSync } from 'node:fs';
// import { join } from 'node:path';
// import { tmpdir } from 'node:os';

  it('collapses a dragged image path into a chip and submits its path', async () => {
    const imgPath = join(tmpdir(), `mdd-attach-${process.pid}.png`);
    writeFileSync(imgPath, Buffer.from([137, 80, 78, 71])); // PNG magic bytes; content irrelevant
    try {
      const store = new UiStore();
      let received: { display: string; text: string; imagePaths: string[] } | null = null;
      const { lastFrame, stdin } = render(<App store={store} onSubmit={(input) => { received = input; }} />);
      stdin.write(imgPath); // whole-path chunk, as a drag/paste delivers it
      await waitForFrame(lastFrame, (f) => f.includes('[Image #1:'));
      const frame = lastFrame() ?? '';
      expect(frame).toContain('[Image #1:');
      expect(frame).not.toContain(imgPath); // raw path hidden behind the chip
      stdin.write('\r');
      await tick();
      expect(received).not.toBeNull();
      expect(received!.display).toContain('[Image #1:');
      expect(received!.imagePaths).toEqual([imgPath]);
      expect(received!.text).not.toContain('[Image #1:'); // image token stripped from model text
    } finally {
      rmSync(imgPath, { force: true });
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — no chip is produced (raw path shown) and `received.imagePaths` is undefined.

- [ ] **Step 3a: Update `src/ui/app.tsx`**

Add the attach imports after the existing paste import (`import { createPasteState, applyChange, expandPastes } from './paste.js';`):
```tsx
import { createAttachState, detectImageInsert, imageLabel, stripImageTokens } from './attach.js';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
```

Extend `SubmitInput`. Change:
```tsx
export interface SubmitInput { display: string; text: string }
```
to:
```tsx
export interface SubmitInput { display: string; text: string; imagePaths: string[] }
```

Add an `attachRef` next to `pasteRef`. After:
```tsx
  const pasteRef = useRef(createPasteState());
```
add:
```tsx
  const attachRef = useRef(createAttachState());
```

Replace `handleSubmit`:
```tsx
  const handleSubmit = () => {
    // Read the live value from the ref, not ink-text-input's (possibly stale) onSubmit argument.
    const current = valueRef.current;
    if (state.pendingPrompt !== null) { setInput(''); pasteRef.current = createPasteState(); store.resolvePrompt(current); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    const display = current.trim();
    const map = pasteRef.current.map;
    setInput('');
    pasteRef.current = createPasteState();
    if (display) onSubmit({ display, text: expandPastes(display, map) });
  };
```
with:
```tsx
  const handleSubmit = () => {
    // Read the live value from the ref, not ink-text-input's (possibly stale) onSubmit argument.
    const current = valueRef.current;
    if (state.pendingPrompt !== null) { setInput(''); pasteRef.current = createPasteState(); attachRef.current = createAttachState(); store.resolvePrompt(current); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    const display = current.trim();
    const pasteMap = pasteRef.current.map;
    const imagePaths = [...attachRef.current.map.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    setInput('');
    pasteRef.current = createPasteState();
    attachRef.current = createAttachState();
    // Model text: expand paste chips to full text, remove image chips (images ride as separate blocks).
    const text = stripImageTokens(expandPastes(display, pasteMap)).trim();
    if (display) onSubmit({ display, text, imagePaths });
  };
```

Replace the `onChange` handler. Change:
```tsx
          onChange={(next) => {
            const r = applyChange(valueRef.current, sanitizeInput(next), pasteRef.current, Date.now());
            pasteRef.current = r.state;
            setInput(r.value);
          }}
```
to:
```tsx
          onChange={(next) => {
            const prev = valueRef.current;
            const r = applyChange(prev, sanitizeInput(next), pasteRef.current, Date.now());
            pasteRef.current = r.state;
            // Image attach: if the just-inserted chunk is an existing image file, collapse it to a chip.
            const cand = detectImageInsert(prev, r.value);
            if (cand) {
              const abs = resolve(process.cwd(), cand.path);
              let exists = false;
              try { exists = statSync(abs).isFile(); } catch { exists = false; }
              if (exists) {
                const n = attachRef.current.count + 1;
                const nextMap = new Map(attachRef.current.map); nextMap.set(n, abs);
                attachRef.current = { map: nextMap, count: n };
                setInput(r.value.slice(0, cand.at) + imageLabel(n, abs) + r.value.slice(cand.at + cand.len));
                return;
              }
            }
            setInput(r.value);
          }}
```

- [ ] **Step 3b: Update `src/cli.ts`**

Add imports. After the existing `import { SessionStore, makeSessionId, truncateTitle, type SessionRecord, type SessionSummary } from './session.js';` line add:
```tsx
import { readFileSync } from 'node:fs';
import { attachImages } from './ui/attach.js';
import type { ContentBlock } from './types.js';
```

Replace the `repl()` submit handler body up to the `messages.push(...)` line. Change:
```tsx
    running = true;
    store.addUser(input.display);
    if (!title) title = truncateTitle(input.display);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: input.text }] });
```
to:
```tsx
    const { blocks, errors } = attachImages(input.imagePaths, (p) => readFileSync(p));
    for (const err of errors) store.addSystem(`⚠ ${err}`);
    if (!input.text && !blocks.length) { return; } // every image failed and no text — nothing to send
    running = true;
    store.addUser(input.display);
    if (!title) title = truncateTitle(input.display);
    store.setStatus('busy');
    const content: ContentBlock[] = [
      ...(input.text ? [{ type: 'text' as const, text: input.text }] : []),
      ...blocks,
    ];
    messages.push({ role: 'user', content });
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run test/ui/app.test.tsx && npx tsc --noEmit`
Expected: the new app test PASSES; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/cli.ts test/ui/app.test.tsx
git commit -m "feat(ui): attach dragged/pasted image paths; send base64 image blocks to the model"
```

---

### Task 4: full verify + build

**Files:** none (verification only).

- [ ] **Step 1: Full suite** — Run: `npx vitest run` — Expected: all PASS (existing + `attach.test.ts` + new provider/app cases).
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Build** — Run: `npm run build` — Expected: `Build success`.
- [ ] **Step 4: Manual smoke** — In `mdd`, drag an image file into the prompt → it collapses to `[Image #1: <name>]`; add a question, press Enter → the transcript shows the chip and MDD responds about the image (on a vision-capable model). Try a >5 MB image → a `⚠ could not attach …` note appears and the turn proceeds without it.
- [ ] **Step 5: Commit** — `git commit --allow-empty -m "chore: verify image attachments end-to-end"`.

## Self-Review

- **Spec coverage:** ImageBlock model + Anthropic base64 source + OpenAI image_url array (Task 1); pure attach.ts detect/dequote/media-type/label/strip + injected-reader encode with 5MB cap (Task 2); onChange whole-chunk detection with statSync existence gate, chip collapse, SubmitInput.imagePaths, submit strips image tokens from model text, cli reads+encodes and builds `[text, …ImageBlock]` content with error notes + empty-turn guard, resets on submit (Task 3); no SessionRecord change (base64 rides in messages); graceful failures via error notes + existing catch. All covered.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `ImageBlock { type, mediaType, data }` defined in `src/types.ts` (Task 1), imported by `attach.ts` (Task 2) and used in `cli.ts` content (Task 3); `SubmitInput { display, text, imagePaths }` (Task 3) matches app→cli usage; `attachImages(paths, read)` signature identical between Task 2 definition and Task 3 call site; `detectImageInsert` returns `{ path, at, len }` used verbatim in the Task 3 onChange.
