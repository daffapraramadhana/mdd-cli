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
