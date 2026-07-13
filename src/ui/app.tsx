import type { ReactNode } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, Static, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { sanitizeInput } from './scroll.js';
import type { UiStore, TranscriptItem } from './store.js';
import { formatStatus, formatPath } from './banner.js';
import { formatToolCall, toolIcon } from './format.js';
import { Markdown } from './markdown.js';
import { getTheme, type Theme } from './theme.js';
import { spinnerFrame, thinkingDots, cursorFrame } from './spinner.js';
import { SelectList } from './select.js';
import { Header } from './header.js';
import { VERSION } from '../version.js';
import { formatUsage } from '../usage.js';

const GUTTER = 5;
const HINTS = '/model  /resume  /theme  /help  /exit';

function Row({ label, color, children }: { label: string; color?: string; children: ReactNode }) {
  return (
    <Box marginTop={1}>
      <Box width={GUTTER} flexShrink={0}>
        <Text color={color} bold={label !== ''}>{label}</Text>
      </Box>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

function ToolLine({ marker, color, text, ms }: { marker: string; color?: string; text: string; ms?: number }) {
  return (
    <Box>
      <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
      <Text color={color}>{`${marker} ${text}`}</Text>
      {ms !== undefined ? <Text dimColor>{`  ${ms}ms`}</Text> : null}
    </Box>
  );
}

function renderItem(item: TranscriptItem, key: number, userNum: number, theme: Theme) {
  if (item.kind === 'user') {
    return (
      <Box key={key} flexDirection="column" marginTop={1}>
        {userNum > 1 ? <Text dimColor>{'─'.repeat(48)}</Text> : null}
        <Box>
          <Box width={GUTTER} flexShrink={0}><Text color={theme.user} bold>You</Text></Box>
          <Text>{item.text}</Text>
          <Text dimColor>{`  #${userNum}`}</Text>
        </Box>
      </Box>
    );
  }
  if (item.kind === 'assistant') {
    return <Row key={key} label="MDD" color={theme.assistant}><Markdown text={item.text} theme={theme} /></Row>;
  }
  if (item.kind === 'system') {
    return (
      <Box key={key} marginTop={1}>
        <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
        <Text dimColor>{item.text}</Text>
      </Box>
    );
  }
  const ok = item.status === 'ok';
  return (
    <ToolLine key={key} marker={ok ? '✓' : '✗'} color={ok ? theme.toolOk : theme.toolError}
      text={`${toolIcon(item.name)} ${formatToolCall(item.name, item.input)}`} ms={item.durationMs} />
  );
}

// The whole REPL renders into the NORMAL terminal buffer: committed history goes through
// <Static> (printed once, scrolled natively by the terminal — smooth, mouse/trackpad, and
// selectable), while the live streaming region, input, and status bar re-render in place at
// the bottom. `showHeader` prints the banner once as the first Static item so it sits at the
// top of scrollback (like Claude Code) instead of being frozen in an alternate screen.
export function App({ store, onSubmit, showHeader = false }: { store: UiStore; onSubmit: (line: string) => void; showHeader?: boolean }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');
  const [tick, setTick] = useState(0);
  const { stdout } = useStdout();
  const width = Math.max(8, (stdout?.columns ?? 80));

  const theme = getTheme(state.themeName);
  const animating = state.activeTool !== null || state.status === 'busy' || state.streaming !== '';

  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick((n) => n + 1), 90);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [animating]);

  const handleSubmit = (v: string) => {
    if (state.pendingPrompt !== null) { setValue(''); store.resolvePrompt(v); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    setValue('');
    if (v.trim()) onSubmit(v.trim());
  };

  const thinking = state.status === 'busy' && state.pendingPrompt === null && !state.streaming && !state.activeTool;
  const meta = state.meta;

  let userNum = 0;
  const allEls = state.transcript.map((item, i) => {
    if (item.kind === 'user') userNum += 1;
    return renderItem(item, i, userNum, theme);
  });
  const staticItems = showHeader
    ? [<Header key="hdr" theme={theme} version={VERSION} />, ...allEls]
    : allEls;

  const liveRows = (
    <>
      {state.streaming ? (
        <Row label="MDD" color={theme.assistant}>
          <Box flexDirection="column">
            <Markdown text={state.streaming} theme={theme} />
            <Text color={theme.assistant}>{cursorFrame(tick)}</Text>
          </Box>
        </Row>
      ) : null}
      {state.activeTool ? (
        <ToolLine marker={spinnerFrame(tick)} color={theme.toolRun}
          text={`${toolIcon(state.activeTool.name)} ${formatToolCall(state.activeTool.name, state.activeTool.input)}`} />
      ) : null}
      {thinking ? (
        <Row label="MDD" color={theme.assistant}><Text dimColor>{`thinking${thinkingDots(tick)}`}</Text></Row>
      ) : null}
    </>
  );

  // Claude-style input chrome: a full-width horizontal rule, then a `>` prompt that stays pinned
  // at the bottom at all times — even mid-turn (busy). While a turn runs, keystrokes still edit
  // the draft, but Enter is held (see handleSubmit) so nothing is sent until the turn finishes.
  const bottom = state.pendingSelect ? (
    <SelectList
      title={state.pendingSelect.title}
      options={state.pendingSelect.options}
      onSelect={(v) => store.resolveSelect(v)}
      onCancel={() => store.resolveSelect(null)}
      accent={theme.accent}
    />
  ) : (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(width)}</Text>
      <Box paddingLeft={1}>
        <Text color={theme.accent}>{'> '}</Text>
        {state.pendingPrompt !== null ? <Text>{state.pendingPrompt} </Text> : null}
        <TextInput value={value} onChange={(v) => setValue(sanitizeInput(v))} onSubmit={handleSubmit} />
        {/* Own dim hint instead of ink-text-input's placeholder, so the cursor is a clean
            block and not an inverted first letter ("A"). Only when idle + empty. */}
        {state.status === 'idle' && state.pendingPrompt === null && value === '' ? <Text dimColor>Ask anything…</Text> : null}
      </Box>
    </Box>
  );

  const statusBar = meta ? (
    <Box flexDirection="column">
      <Text>
        <Text color={theme.accent} bold>mdd</Text>
        <Text>{'  '}</Text>
        <Text dimColor>{formatStatus(meta)}</Text>
        {state.usage.inputTokens + state.usage.outputTokens > 0
          ? <Text dimColor>{`  · ${formatUsage(state.usage, meta.model)}`}</Text>
          : null}
      </Text>
      <Text dimColor>{`${HINTS}    ${formatPath(meta)} · ctrl-c exit`}</Text>
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(el) => el}</Static>
      {liveRows}
      {bottom ? <Box marginTop={1}>{bottom}</Box> : null}
      {statusBar ? <Box marginTop={state.pendingSelect ? 1 : 0}>{statusBar}</Box> : null}
    </Box>
  );
}
