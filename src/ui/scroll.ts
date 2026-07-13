// src/ui/scroll.ts
// Input sanitization for the prompt field. Kept free of React/Ink so it is unit-testable.
// Strips escape/mouse sequences and stray control bytes that can arrive from pastes (or, in
// terminals that emit them, mouse reports) so nothing garbles the input line.

// Full CSI escape sequence, ESC required (e.g. cursor `\x1b[H`, a color run).
const CSI = /\x1b\[[0-9;<>?]*[ -/]*[@-~]/g;
// SGR mouse report `[<64;10;5M`. Some terminals/parsers strip the leading ESC before the
// bytes reach the input, so the ESC is optional here. The `<` after `[` makes this specific
// enough that it never touches legitimate bracket/array text like `[0]` or `[a; b]`.
const MOUSE_LEAK = /\x1b?\[<\d+;\d+;\d+[Mm]/g;
// Stray control chars, but keep \t (0x09) and \n (0x0a) which are legitimate.
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** Remove escape/mouse sequences and stray control bytes so nothing leaks into the prompt. */
export function sanitizeInput(value: string): string {
  return value.replace(CSI, '').replace(MOUSE_LEAK, '').replace(CTRL, '');
}
