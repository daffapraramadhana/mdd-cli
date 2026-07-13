import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';
export { formatBanner, formatStatus, formatPath, shortenCwd, type SessionMeta } from './banner.js';

// meta now lives in the store (store.setMeta), so the footer updates live on /model etc.
export function mountApp(store: UiStore, onSubmit: (line: string) => void): { unmount(): void; waitUntilExit(): Promise<void> } {
  const instance = render(<App store={store} onSubmit={onSubmit} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}

const ALT_ENTER = '\x1b[?1049h\x1b[2J\x1b[H'; // enter alternate screen, clear, cursor home
const ALT_LEAVE = '\x1b[?1049l';             // leave alternate screen (restores the shell)

// Fullscreen REPL: takes over the terminal in the alternate screen buffer and restores on exit.
export function mountFullscreen(store: UiStore, onSubmit: (line: string) => void): { unmount(): void; waitUntilExit(): Promise<void> } {
  process.stdout.write(ALT_ENTER);
  let cleaned = false;
  const cleanup = (): void => { if (cleaned) return; cleaned = true; process.stdout.write(ALT_LEAVE); };
  process.on('exit', cleanup);
  const instance = render(<App store={store} onSubmit={onSubmit} fullscreen />);
  void instance.waitUntilExit().finally(() => { cleanup(); process.off('exit', cleanup); });
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
