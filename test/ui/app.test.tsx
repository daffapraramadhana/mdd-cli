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

  it('formats markdown live while streaming (no snap on commit)', () => {
    const store = new UiStore();
    store.appendStreaming('Use **npm test** and a heading\n# Heading');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('npm test');
    expect(frame).toContain('Heading');
    expect(frame).not.toContain('**'); // markers already stripped mid-stream
  });

  it('renders a completed tool line with a ✓ and prettified args', () => {
    const store = new UiStore();
    store.addUser('list files');
    store.startTool('list_dir', { path: '.' });
    store.endTool('ok');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('list files');
    expect(frame).toContain('list_dir(.)');
    expect(frame).toContain('✓');
  });

  it('renders a failed tool line with a ✗', () => {
    const store = new UiStore();
    store.startTool('run_shell', { command: 'false' });
    store.endTool('error');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('run_shell(false)');
    expect(frame).toContain('✗');
  });

  it('renders a running tool live with an animated spinner frame + icon', () => {
    const store = new UiStore();
    store.setStatus('busy');
    store.startTool('read_file', { path: 'package.json' });
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file(package.json)');
    expect(frame).toContain('▤'); // tool icon
    expect(frame).toContain('⠋'); // first spinner frame (tick 0)
  });

  it('renders markdown in a committed assistant reply (bold, inline code, code block)', () => {
    const store = new UiStore();
    store.appendStreaming('Use **npm test**. Run `vitest`.\n```\nnpm test\n```');
    store.commitStreaming();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    // Markers are stripped; content remains
    expect(frame).toContain('npm test');
    expect(frame).toContain('vitest');
    expect(frame).not.toContain('**');
    expect(frame).not.toContain('```');
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

  it('renders the status + path footer from the store meta', () => {
    const store = new UiStore();
    store.setMeta({ provider: 'openai', model: 'cc/claude-opus-4-8', cwd: '~/proj', branch: 'main', autoApprove: true });
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('mdd');
    expect(frame).toContain('openai');
    expect(frame).toContain('cc/claude-opus-4-8');
    expect(frame).toContain('~/proj (main)');
    expect(frame).toContain('auto-approve');
    expect(frame).toContain('/model');
  });

  it('renders a system (command feedback) line', () => {
    const store = new UiStore();
    store.addSystem('→ model set to cc/claude-sonnet-5');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    expect(lastFrame()).toContain('→ model set to cc/claude-sonnet-5');
  });

  it('shows the input placeholder when idle and empty', () => {
    const store = new UiStore();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    expect(lastFrame()).toContain('Ask anything');
  });

  it('does not leak a typed/pasted mouse sequence into the input field', () => {
    const store = new UiStore();
    const { lastFrame, stdin } = render(<App store={store} onSubmit={() => {}} />);
    stdin.write('hi\x1b[<64;10;5Mthere'); // a wheel sequence embedded in typed text
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[<64'); // escape sequence stripped
    expect(frame).not.toContain('64;10;5');
  });
});
