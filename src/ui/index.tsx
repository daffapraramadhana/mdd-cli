import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';
import type { SessionMeta } from './banner.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';
export { formatBanner, formatStatus, shortenCwd, type SessionMeta } from './banner.js';

export function mountApp(store: UiStore, onSubmit: (line: string) => void, meta?: SessionMeta): { unmount(): void; waitUntilExit(): Promise<void> } {
  const instance = render(<App store={store} onSubmit={onSubmit} meta={meta} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
