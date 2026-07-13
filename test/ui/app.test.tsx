import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/app.js';
import { UiStore } from '../../src/ui/store.js';

describe('App', () => {
  it('renders streaming text and an input line when idle', () => {
    const store = new UiStore();
    store.appendStreaming('hello world');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    expect(lastFrame()).toContain('hello world');
  });

  it('renders a committed user line and a tool line from the transcript', () => {
    const store = new UiStore();
    store.addUser('list files');
    store.addTool('list_dir', { path: '.' });
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('list files');
    expect(frame).toContain('list_dir');
  });

  it('shows the permission message when a prompt is pending', () => {
    const store = new UiStore();
    void store.requestPrompt('Allow write_file? [y/n/a]');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    expect(lastFrame()).toContain('Allow write_file?');
  });

  it('labels user input with "You" and assistant turns with "MDD"', () => {
    const store = new UiStore();
    store.addUser('hi there');
    store.appendStreaming('hello back');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('You');
    expect(frame).toContain('hi there');
    expect(frame).toContain('MDD');
    expect(frame).toContain('hello back');
  });

  it('renders the status footer when meta is provided', () => {
    const store = new UiStore();
    const { lastFrame } = render(
      <App store={store} onSubmit={() => {}} meta={{ provider: 'openai', model: 'cc/claude-opus-4-8', cwd: '~/proj', autoApprove: true }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('openai');
    expect(frame).toContain('cc/claude-opus-4-8');
    expect(frame).toContain('~/proj');
    expect(frame).toContain('auto-approve');
  });
});
