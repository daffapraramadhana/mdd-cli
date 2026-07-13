import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';
export { formatBanner, formatStatus, formatPath, shortenCwd, type SessionMeta } from './banner.js';

// Inline rendering (no alternate screen): committed content lands in the terminal's native
// scrollback and persists after exit, exactly like Claude Code. `showHeader` prints the
// welcome banner once at the top (REPL only; one-shot stays clean for piping).
export function mountApp(store: UiStore, onSubmit: (line: string) => void, showHeader = false): { unmount(): void; waitUntilExit(): Promise<void> } {
  const instance = render(<App store={store} onSubmit={onSubmit} showHeader={showHeader} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
