// src/ui/select.tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface ChoiceOption { label: string; value: string; opensInput?: boolean; inputPlaceholder?: string; }
export interface PromptSpec { title: string; body?: string[]; options: ChoiceOption[]; }
export type ChoiceResult = { value: string; text?: string } | null;

/** Wrap an index into [0, len) with up/down wraparound. */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

export function SelectList({ spec, onResolve, accent }: { spec: PromptSpec; onResolve: (r: ChoiceResult) => void; accent: string }) {
  const [idx, setIdx] = useState(0);
  const [inputFor, setInputFor] = useState<ChoiceOption | null>(null);
  const [text, setText] = useState('');

  useInput((_input, key) => {
    if (inputFor) {
      if (key.escape) { setInputFor(null); setText(''); } // back to the list
      return; // Enter/typing handled by TextInput below
    }
    if (key.upArrow) setIdx((i) => clampIndex(i - 1, spec.options.length));
    else if (key.downArrow) setIdx((i) => clampIndex(i + 1, spec.options.length));
    else if (key.escape) onResolve(null);
    else if (key.return) {
      const opt = spec.options[idx];
      if (opt.opensInput) { setInputFor(opt); setText(''); }
      else onResolve({ value: opt.value });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Text bold color={accent}>{spec.title}</Text>
      {(spec.body ?? []).map((line, i) => <Text key={`b${i}`} dimColor>{line}</Text>)}
      {inputFor ? (
        <Box>
          <Text color={accent}>{`↳ `}</Text>
          <TextInput value={text} onChange={setText} onSubmit={() => onResolve({ value: inputFor.value, text })} />
          {text === '' && inputFor.inputPlaceholder ? <Text dimColor>{inputFor.inputPlaceholder}</Text> : null}
        </Box>
      ) : (
        spec.options.map((opt, i) =>
          i === idx
            ? <Text key={i} color={accent} bold>{`❯ ${opt.label}`}</Text>
            : <Text key={i}>{`  ${opt.label}`}</Text>,
        )
      )}
      <Text dimColor>{inputFor ? 'enter send · esc back' : '↑/↓ move · enter select · esc cancel'}</Text>
    </Box>
  );
}
