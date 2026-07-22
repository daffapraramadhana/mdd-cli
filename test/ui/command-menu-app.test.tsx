// test/ui/command-menu-app.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/app.js';
import { UiStore } from '../../src/ui/store.js';

const cmds = [
  { name: 'model', description: 'switch model' },
  { name: 'plugin', description: 'manage plugins' },
];

// NOTE: deliberately not calling store.setMeta here. Setting meta renders the status bar,
// which includes the static HINTS footer ('/model  /plugin  /resume ...' — see app.tsx) that
// would always contain the literal substrings these assertions check for, regardless of
// whether the live slash-command menu itself is filtering correctly. Leaving meta null keeps
// the assertions a true test of CommandMenu's filtering rather than a false positive/negative
// from the unrelated hints line. The menu's open/closed logic doesn't depend on meta.
function setupStore(): UiStore {
  return new UiStore();
}

describe('App slash menu', () => {
  it('shows matching commands when the input starts with a slash', async () => {
    const store = setupStore();
    const { stdin, lastFrame } = render(<App store={store} onSubmit={() => {}} commands={cmds} />);
    stdin.write('/pl');
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame()!;
    expect(frame).toContain('/plugin');
    expect(frame).not.toContain('/model'); // filtered out by the 'pl' prefix
  });

  it('hides the menu once a space starts the args', async () => {
    const store = setupStore();
    const { stdin, lastFrame } = render(<App store={store} onSubmit={() => {}} commands={cmds} />);
    stdin.write('/plugin ');
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).not.toContain('manage plugins');
  });
});
