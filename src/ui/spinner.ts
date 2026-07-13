// src/ui/spinner.ts
// Frame helpers for the animated indicators. Driven by a monotonic tick counter.

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[((tick % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length];
}

/** Cycles '', '.', '..', '...' for the thinking indicator. */
export function thinkingDots(tick: number): string {
  return '.'.repeat(tick % 4);
}

/** A soft block cursor that blinks on even ticks. */
export function cursorFrame(tick: number): string {
  return tick % 2 === 0 ? '▌' : ' ';
}
