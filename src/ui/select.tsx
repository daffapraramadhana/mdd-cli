// src/ui/select.tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/** Wrap an index into [0, len) with up/down wraparound. */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

export function SelectList({
  title,
  options,
  onSelect,
  onCancel,
  accent,
}: {
  title: string;
  options: string[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  accent: string;
}) {
  const [idx, setIdx] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIdx((i) => clampIndex(i - 1, options.length));
    else if (key.downArrow) setIdx((i) => clampIndex(i + 1, options.length));
    else if (key.return) onSelect(options[idx]);
    else if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Text bold color={accent}>{title}</Text>
      {options.map((opt, i) =>
        i === idx ? (
          <Text key={i} color={accent} bold>{`❯ ${opt}`}</Text>
        ) : (
          <Text key={i}>{`  ${opt}`}</Text>
        ),
      )}
      <Text dimColor>↑/↓ move · enter select · esc cancel</Text>
    </Box>
  );
}
