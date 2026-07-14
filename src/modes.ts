// The REPL permission posture, cycled with Shift+Tab. Kept dependency-free so the gate,
// status bar, and cli can all import it without circular references.

export type Mode = 'normal' | 'auto-edit' | 'plan';

const ORDER: Mode[] = ['normal', 'auto-edit', 'plan'];

/** Rotate to the next mode: normal → auto-edit → plan → normal. */
export function nextMode(mode: Mode): Mode {
  const i = ORDER.indexOf(mode);
  return ORDER[(i + 1) % ORDER.length];
}

/** Human-readable label for the status bar and system messages. */
export function modeLabel(mode: Mode): string {
  if (mode === 'auto-edit') return 'auto-accept edits';
  return mode; // 'normal' | 'plan'
}

/** Tools auto-approved in auto-edit mode (file edits only; not shell/git). */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'multi_edit']);
