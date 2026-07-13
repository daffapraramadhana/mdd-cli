import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { Box, Text, Static } from 'ink';
import TextInput from 'ink-text-input';
import type { UiStore, TranscriptItem } from './store.js';
import { formatStatus, type SessionMeta } from './banner.js';

const GUTTER = 5;

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

function renderItem(item: TranscriptItem, key: number) {
  if (item.kind === 'user') {
    return <Row key={key} label="You" color="cyan"><Text>{item.text}</Text></Row>;
  }
  if (item.kind === 'assistant') {
    return <Row key={key} label="MDD" color="magenta"><Text>{item.text}</Text></Row>;
  }
  return (
    <Box key={key}>
      <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
      <Text color="yellow">{`↳ ${item.name} ${JSON.stringify(item.input)}`}</Text>
    </Box>
  );
}

export function App({
  store,
  onSubmit,
  meta,
}: {
  store: UiStore;
  onSubmit: (line: string) => void;
  meta?: SessionMeta;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');

  const handleSubmit = (v: string) => {
    setValue('');
    if (state.pendingPrompt !== null) { store.resolvePrompt(v); return; }
    if (v.trim()) onSubmit(v.trim());
  };

  const inputActive = state.pendingPrompt !== null || state.status === 'idle';
  const thinking = state.status === 'busy' && state.pendingPrompt === null && !state.streaming;

  return (
    <Box flexDirection="column">
      <Static items={state.transcript}>{(item, i) => renderItem(item, i)}</Static>

      {state.streaming ? (
        <Row label="MDD" color="magenta"><Text>{state.streaming}</Text></Row>
      ) : null}
      {thinking ? (
        <Row label="MDD" color="magenta"><Text dimColor>…thinking</Text></Row>
      ) : null}

      {meta ? (
        <Box marginTop={1}>
          <Text dimColor>{formatStatus(meta)}</Text>
        </Box>
      ) : null}

      {inputActive ? (
        <Box>
          <Text color="cyan">{state.pendingPrompt ?? '› '}</Text>
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
        </Box>
      ) : null}
    </Box>
  );
}
