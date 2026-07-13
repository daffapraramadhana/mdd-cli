import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { Box, Text, Static } from 'ink';
import TextInput from 'ink-text-input';
import type { UiStore, TranscriptItem } from './store.js';
import { formatStatus, formatPath } from './banner.js';
import { formatToolCall } from './format.js';
import { Markdown } from './markdown.js';

const GUTTER = 5;
const HINTS = '/model  /models  /provider  /help';

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

function ToolLine({ marker, color, text }: { marker: string; color?: string; text: string }) {
  return (
    <Box>
      <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
      <Text color={color}>{`${marker} ${text}`}</Text>
    </Box>
  );
}

function renderItem(item: TranscriptItem, key: number) {
  if (item.kind === 'user') {
    return <Row key={key} label="You" color="cyan"><Text>{item.text}</Text></Row>;
  }
  if (item.kind === 'assistant') {
    return <Row key={key} label="MDD" color="magenta"><Markdown text={item.text} /></Row>;
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
      color={ok ? 'green' : 'red'}
      text={formatToolCall(item.name, item.input)}
    />
  );
}

export function App({ store, onSubmit }: { store: UiStore; onSubmit: (line: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');

  const handleSubmit = (v: string) => {
    setValue('');
    if (state.pendingPrompt !== null) { store.resolvePrompt(v); return; }
    if (v.trim()) onSubmit(v.trim());
  };

  const inputActive = state.pendingPrompt !== null || state.status === 'idle';
  const thinking = state.status === 'busy' && state.pendingPrompt === null && !state.streaming;
  const meta = state.meta;

  return (
    <Box flexDirection="column">
      <Static items={state.transcript}>{(item, i) => renderItem(item, i)}</Static>

      {state.streaming ? (
        <Row label="MDD" color="magenta"><Text>{state.streaming}</Text></Row>
      ) : null}
      {state.activeTool ? (
        <ToolLine marker="⋯" color="gray" text={formatToolCall(state.activeTool.name, state.activeTool.input)} />
      ) : null}
      {thinking && !state.activeTool ? (
        <Row label="MDD" color="magenta"><Text dimColor>…thinking</Text></Row>
      ) : null}

      {inputActive ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="magenta"
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={1}
        >
          {state.pendingPrompt !== null ? <Text>{state.pendingPrompt} </Text> : null}
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder={state.pendingPrompt !== null ? undefined : 'Ask anything…'}
          />
        </Box>
      ) : null}

      {meta ? (
        <Box flexDirection="column" marginTop={inputActive ? 0 : 1}>
          <Text>
            <Text color="magenta" bold>mdd</Text>
            <Text>{'  '}</Text>
            <Text dimColor>{formatStatus(meta)}</Text>
          </Text>
          <Text dimColor>{`${HINTS}    ${formatPath(meta)} · ctrl-c exit`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
