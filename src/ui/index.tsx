import { render } from 'ink';
import { App, type SubmitInput } from './app.js';
import { UiStore } from './store.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';
export type { SubmitInput } from './app.js';
export { formatBanner, formatStatus, formatPath, shortenCwd, type SessionMeta } from './banner.js';

// Clear the screen AND the scrollback, then home the cursor. Run once at REPL startup so the
// banner becomes the top of the buffer — scrolling up stops at it instead of bleeding into the
// pre-existing shell output, exactly like Claude Code. `\x1b[3J` clears scrollback (xterm ext,
// supported by iTerm2/Terminal.app/Ghostty/etc).
const CLEAR_ALL = '\x1b[2J\x1b[3J\x1b[H';

// The app renders into the NORMAL terminal buffer (not the alternate screen), so the terminal's
// own native scrollback handles scrolling — smooth, mouse/trackpad-driven, and text-selectable,
// just like Claude Code. Committed history is printed via <Static> and stays in scrollback after
// exit. `showHeader` prints the banner once at the top and clears the terminal first (interactive
// REPL); one-shot mode omits both so piped output stays clean.
export function mountApp(
  store: UiStore,
  onSubmit: (input: SubmitInput) => void,
  opts: { showHeader?: boolean; onCycleMode?: () => void } = {},
): { unmount(): void; waitUntilExit(): Promise<void> } {
  if (opts.showHeader) process.stdout.write(CLEAR_ALL);
  const instance = render(<App store={store} onSubmit={onSubmit} showHeader={opts.showHeader} onCycleMode={opts.onCycleMode} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
