import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';
import { getTheme } from './theme.js';
import { renderTranscriptText } from './transcript-text.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';
export { formatBanner, formatStatus, formatPath, shortenCwd, type SessionMeta } from './banner.js';

// Inline rendering (one-shot): content lands in native scrollback; no header, clean for piping.
export function mountApp(store: UiStore, onSubmit: (line: string) => void): { unmount(): void; waitUntilExit(): Promise<void> } {
  const instance = render(<App store={store} onSubmit={onSubmit} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}

const ALT_ENTER = '\x1b[?1049h\x1b[2J\x1b[H'; // enter alternate screen, clear, cursor home
const ALT_LEAVE = '\x1b[?1049l';             // leave alternate screen (restores the shell)

// Fullscreen REPL: runs in the alternate screen, and on exit re-prints the conversation to
// the normal buffer so it persists in scrollback (instead of leaving a blank terminal).
export function mountFullscreen(store: UiStore, onSubmit: (line: string) => void): { unmount(): void; waitUntilExit(): Promise<void> } {
  process.stdout.write(ALT_ENTER);
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    process.stdout.write(ALT_LEAVE);
    const { transcript, themeName } = store.getState();
    if (transcript.length) {
      process.stdout.write(renderTranscriptText(transcript, getTheme(themeName)) + '\n');
    }
  };
  process.on('exit', cleanup);
  const instance = render(<App store={store} onSubmit={onSubmit} fullscreen />);
  void instance.waitUntilExit().finally(() => { cleanup(); process.off('exit', cleanup); });
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
