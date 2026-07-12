import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';

export { UiStore } from './store.js';
export type { TranscriptItem, UiState } from './store.js';

export function mountApp(store: UiStore, onSubmit: (line: string) => void): { unmount(): void; waitUntilExit(): Promise<void> } {
  const instance = render(<App store={store} onSubmit={onSubmit} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
