# Image Attachments — Design

**Date:** 2026-07-14
**Status:** Approved for planning (implementation pending)
**Area:** `src/types.ts`, `src/providers/anthropic.ts`, `src/providers/openai.ts`, `src/ui/attach.ts` (new), `src/ui/app.tsx`, `src/cli.ts`

## Problem

mdd is text-only. Users want to send images to the model — drag an image file into the prompt (or
paste its path) and have it attached to the message. Terminals cannot receive binary "drops": a
drag inserts the file's **path**. So "drop an image" = detect an image-file path in the prompt,
read the file, and attach it as a base64 image block.

## Decisions (locked)

- **Trigger:** auto-detect an image-file path inserted as a **chunk** (drag-drop or paste inserts the
  whole path at once). When the inserted chunk, de-quoted, is an existing file whose extension is one
  of `.png .jpg .jpeg .gif .webp`, replace it inline with an `[Image #<n>: <basename>]` chip and
  remember the absolute path. Numbering `#1, #2 …` per composing buffer, resets on submit.
- **Read timing:** the file read + base64 encode happens **at submit** (in `cli.ts`, which is async),
  never in `onChange` — the UI must not block on a large file. Existence is checked synchronously in
  `onChange` via `statSync` (cheap, local).
- **Size cap:** reject files larger than **5 MB**; on submit, emit a system note and skip that image.
- **Model delivery:** images become a new `ImageBlock` in the user message content, mapped per
  provider. Vision capability is not pre-checked; if the model/endpoint rejects images, the existing
  error path surfaces it (with a clearer note).
- **Collapsed everywhere:** the `[Image #n: name]` chip shows in the input AND the transcript; the
  model receives the actual image bytes (base64), not the chip text.

## Non-goals (YAGNI)

- Explicit `/image <path>` command and `@path` mention (auto-detect covers drag/paste).
- Character-by-character typed path detection (only whole-chunk inserts are detected).
- Clipboard image-binary paste (unreliable across terminals).
- Image resizing/optimization, or storing images out-of-line (base64 rides in `messages`).
- Pre-flighting vision capability per model.

## Message model (`src/types.ts`)

```ts
export interface ImageBlock { type: 'image'; mediaType: string; data: string; } // data = base64, no data: prefix
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;
```

## Provider mapping

**Anthropic** (`toAnthropicMessages`): add a branch —
```ts
if (b.type === 'image') return { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } };
```

**OpenAI** (`toOpenAIMessages`): the user branch currently pushes `{ role:'user', content: text }` (a
plain string). When the message has image blocks, push an **array** content instead:
```ts
const images = m.content.filter((b) => b.type === 'image') as ImageBlock[];
if (text || images.length) {
  out.push(images.length
    ? { role: 'user', content: [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
      ] }
    : { role: 'user', content: text });
}
```
Assistant messages never carry images (model output is text/tool_use), so that branch is unchanged.

## New module: `src/ui/attach.ts`

Pure, no React/Ink/fs imports (the caller injects a file reader), fully unit-testable.

```ts
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AttachState { map: Map<number, string>; count: number; } // chip number → absolute path
export function createAttachState(): AttachState;

export function dequotePath(chunk: string): string;          // trims surrounding '...'/"..." and unescapes "\ " → " "
export function isImagePath(chunk: string): boolean;          // de-quoted, has a dir-ish shape, ext ∈ IMAGE_EXTS
export function mediaTypeFor(path: string): string;          // .jpg/.jpeg→image/jpeg, .png→image/png, etc.
export function imageLabel(n: number, path: string): string; // "[Image #1: shot.png]" (basename)
export function stripImageTokens(display: string): string;   // removes every "[Image #<n>: …]" token

// Read + encode each path with an INJECTED reader so this stays fs-free and unit-testable.
// The reader returns the raw bytes; a null/throw means unreadable → an error string is produced.
export interface ImageBlock { type: 'image'; mediaType: string; data: string; } // re-uses src/types.ts shape
export function attachImages(
  paths: string[],
  read: (path: string) => Uint8Array,   // caller passes readFileSync; may throw
): { blocks: ImageBlock[]; errors: string[] };
//   For each path: read → if bytes.length > MAX_IMAGE_BYTES push an error and skip; else base64-encode
//   → ImageBlock{ mediaType: mediaTypeFor(path), data }. A thrown read → error "could not attach <name>: <reason>".
```

`ImageBlock` is defined canonically in `src/types.ts`; `attach.ts` imports that type (type-only import,
no runtime/fs dependency) rather than redeclaring it.

## `app.tsx` changes

- A `attachRef` (like `pasteRef`) holds `{ map: Map<number, string>; count: number }` — chip number → absolute path.
- In `onChange`, after the existing paste `applyChange`, run image detection on the **inserted chunk**
  (diff `prev`→`next`, same technique as `detectPaste`): if `isImagePath(dequotePath(chunk))` AND
  `statSync(path)` succeeds, replace the chunk in the value with `imageLabel(n, path)`, store the
  absolute path under `n`, and `setInput(collapsed)`. Detection order: a chunk that is a long paste
  is handled by paste-collapse; an image path is short, so the two never contend.
- `handleSubmit`: build `display` (collapsed, with chips), `text = stripImageTokens(expandPastes(display, pasteMap))`
  (paste tokens expanded, image tokens removed — images are separate blocks), and
  `imagePaths = [...attachRef.current.map by ascending key]`. Call
  `onSubmit({ display, text, imagePaths })`. Reset both `pasteRef` and `attachRef` via `createPasteState()`
  / a new `createAttachState()`.

`SubmitInput` becomes `{ display: string; text: string; imagePaths: string[] }`.

## `cli.ts` changes

- `repl()`'s `onSubmit` calls `attachImages(input.imagePaths, (p) => readFileSync(p))` (the injected
  reader does the size check via `attachImages`' `MAX_IMAGE_BYTES` guard on `bytes.length`). Each
  returned `errors[]` entry → `store.addSystem('⚠ ' + err)`. Build the user message:
  `content = [{ type:'text', text: input.text }, ...blocks]` (omit the text block if `input.text` is
  empty but `blocks` is non-empty). `store.addUser(input.display)` for the transcript (chip visible).
  Slash-command detection still uses `input.display`. If `input.text` is empty AND `blocks` is empty
  (e.g. every image failed), do not start a turn.
- `oneShot` is unchanged (no attachments).
- Reads that throw → `store.addSystem('⚠ could not attach <name>: <reason>')`, image skipped, the rest
  of the turn proceeds.

## Data flow

Drag/paste image path → `onChange` detects chunk is an existing image file → chip + path stored →
(compose more) → submit → `cli.ts` reads+encodes each path (size-capped) → user message
`content = [text, …ImageBlock]` → provider maps to base64 (Anthropic `source` / OpenAI `image_url`).
Transcript shows the chip; `messages` (and thus persisted session) carries the base64 blocks.

## Error handling / edge cases

- Non-existent path or non-image extension → not detected, stays literal text.
- File deleted between compose and submit, unreadable, or > 5 MB → skipped with a system note; turn
  continues with remaining content.
- Model/endpoint without vision → the provider call errors; surfaced via the existing catch with a
  note that the model may not support images.
- A user who types a literal `[Image #1: x]` with no stored entry → `stripImageTokens` still removes
  it from the model text (cosmetic only; no image attached). Acceptable.

## Testing

- `test/ui/attach.test.ts` (pure): `dequotePath` (single/double quotes, `\ ` escapes), `isImagePath`
  (each ext, non-image rejected, bare word rejected), `mediaTypeFor` (jpg/jpeg→jpeg), `imageLabel`
  (basename), `stripImageTokens` (single/multiple/none).
- `test/providers/anthropic.test.ts` / `openai.test.ts`: an `ImageBlock` maps to the base64 `source`
  (Anthropic) and to an `image_url` array item with a `data:` URL (OpenAI); text-only messages
  unchanged.
- `test/ui/app.test.tsx`: writing an existing image path (temp file) as a chunk shows `[Image #1:` and
  hides the raw path; `onSubmit` payload carries the path in `imagePaths`.
- `test/cli.*.test.ts` (pure helper): the read/encode + size-cap logic extracted to a testable helper
  (e.g. `attachImages(paths, readFileSyncish): { blocks: ImageBlock[]; errors: string[] }`) — over-cap
  and unreadable paths produce errors, valid ones produce base64 blocks with the right media type.
