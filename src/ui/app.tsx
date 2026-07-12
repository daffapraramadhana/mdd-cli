import { useState, useSyncExternalStore } from 'react';
import { Box, Text, Static } from 'ink';
import TextInput from 'ink-text-input';
import type { UiStore, TranscriptItem } from './store.js';

function renderItem(item: TranscriptItem, key: number) {
  if (item.kind === 'user') return <Text key={key} color="cyan">{`› ${item.text}`}</Text>;
  if (item.kind === 'assistant') return <Text key={key}>{item.text}</Text>;
  return <Text key={key} color="yellow">{`↳ ${item.name} ${JSON.stringify(item.input)}`}</Text>;
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

  return (
    <Box flexDirection="column">
      <Static items={state.transcript}>{(item, i) => renderItem(item, i)}</Static>
      {state.streaming ? <Text>{state.streaming}</Text> : null}
      {state.status === 'busy' && state.pendingPrompt === null ? <Text color="gray">…thinking</Text> : null}
      {inputActive ? (
        <Box>
          <Text>{state.pendingPrompt ?? '› '}</Text>
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
        </Box>
      ) : null}
    </Box>
  );
}
