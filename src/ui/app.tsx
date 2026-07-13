import type { ReactNode } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, Static } from 'ink';
import TextInput from 'ink-text-input';
import type { UiStore, TranscriptItem } from './store.js';
import { formatStatus, formatPath } from './banner.js';
import { formatToolCall, toolIcon } from './format.js';
import { Markdown } from './markdown.js';
import { getTheme, type Theme } from './theme.js';
import { spinnerFrame, thinkingDots, cursorFrame } from './spinner.js';

const GUTTER = 5;
const HINTS = '/model  /theme  /help';

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
    return <Row key={key} label="MDD" color={theme.assistant}><Markdown text={item.text} codeColor={theme.code} accent={theme.accent} /></Row>;
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
    <ToolLine
      key={key}
      marker={ok ? '✓' : '✗'}
      color={ok ? theme.toolOk : theme.toolError}
      text={`${toolIcon(item.name)} ${formatToolCall(item.name, item.input)}`}
      ms={item.durationMs}
    />
  );
}

export function App({ store, onSubmit }: { store: UiStore; onSubmit: (line: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');
  const [tick, setTick] = useState(0);

  const theme = getTheme(state.themeName);
  const animating = state.activeTool !== null || state.status === 'busy' || state.streaming !== '';

  // A single interval drives all animation, and only runs while something animates.
  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick((n) => n + 1), 90);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [animating]);

  const handleSubmit = (v: string) => {
    setValue('');
    if (state.pendingPrompt !== null) { store.resolvePrompt(v); return; }
    if (v.trim()) onSubmit(v.trim());
  };

  const inputActive = state.pendingPrompt !== null || state.status === 'idle';
  const thinking = state.status === 'busy' && state.pendingPrompt === null && !state.streaming && !state.activeTool;
  const meta = state.meta;

  // Precompute elements with per-user ordinal (for #counter + dividers).
  let userNum = 0;
  const elements = state.transcript.map((item, i) => {
    if (item.kind === 'user') userNum += 1;
    return renderItem(item, i, userNum, theme);
  });

  return (
    <Box flexDirection="column">
      <Static items={elements}>{(el) => el}</Static>

      {state.streaming ? (
        <Row label="MDD" color={theme.assistant}>
          <Text>{state.streaming}<Text color={theme.assistant}>{cursorFrame(tick)}</Text></Text>
        </Row>
      ) : null}
      {state.activeTool ? (
        <ToolLine
          marker={spinnerFrame(tick)}
          color={theme.toolRun}
          text={`${toolIcon(state.activeTool.name)} ${formatToolCall(state.activeTool.name, state.activeTool.input)}`}
        />
      ) : null}
      {thinking ? (
        <Row label="MDD" color={theme.assistant}><Text dimColor>{`thinking${thinkingDots(tick)}`}</Text></Row>
      ) : null}

      {inputActive ? (
        <Box marginTop={1} borderStyle="round" borderColor={theme.accent} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
          {state.pendingPrompt !== null ? <Text>{state.pendingPrompt} </Text> : null}
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} placeholder={state.pendingPrompt !== null ? undefined : 'Ask anything…'} />
        </Box>
      ) : null}

      {meta ? (
        <Box flexDirection="column" marginTop={inputActive ? 0 : 1}>
          <Text>
            <Text color={theme.accent} bold>mdd</Text>
            <Text>{'  '}</Text>
            <Text dimColor>{formatStatus(meta)}</Text>
          </Text>
          <Text dimColor>{`${HINTS}    ${formatPath(meta)} · ctrl-c exit`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
