// src/ui/transcript-text.ts
// Renders the committed transcript to an ANSI string. On exit from the fullscreen
// (alternate-screen) TUI we print this to the normal buffer so the conversation
// lands in the terminal's scrollback instead of vanishing.
import { hexToRgb, type Theme } from './theme.js';
import { formatToolCall, toolIcon } from './format.js';
import type { TranscriptItem } from './store.js';

function color(hex: string, s: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

export function renderTranscriptText(items: TranscriptItem[], theme: Theme): string {
  const out: string[] = [];
  let userNum = 0;
  for (const it of items) {
    if (it.kind === 'user') {
      userNum += 1;
      if (out.length) out.push('');
      out.push(`${color(theme.user, 'You')}  ${it.text}  ${dim(`#${userNum}`)}`);
    } else if (it.kind === 'assistant') {
      const [first, ...rest] = it.text.split('\n');
      out.push(`${color(theme.assistant, 'MDD')}  ${first}`);
      for (const line of rest) out.push(`     ${line}`);
    } else if (it.kind === 'system') {
      out.push(`     ${dim(it.text)}`);
    } else {
      const ok = it.status === 'ok';
      const c = ok ? theme.toolOk : theme.toolError;
      out.push(`     ${color(c, `${ok ? '✓' : '✗'} ${toolIcon(it.name)} ${formatToolCall(it.name, it.input)}`)}  ${dim(`${it.durationMs}ms`)}`);
    }
  }
  return out.join('\n');
}
