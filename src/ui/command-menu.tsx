import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { SlashCommand } from './slash-commands.js';
import type { Theme } from './theme.js';

export function CommandMenu({ commands, highlight, theme, max = 8 }: {
  commands: SlashCommand[];
  highlight: number;
  theme: Theme;
  max?: number;
}): ReactNode {
  if (commands.length === 0) return null;
  const overflow = commands.length > max;
  const shown = overflow ? commands.slice(0, max - 1) : commands.slice(0, max);
  const moreCount = commands.length - shown.length;
  return (
    <Box flexDirection="column">
      {shown.map((c, i) =>
        i === highlight
          ? <Text key={c.name} color={theme.accent} bold>{`❯ /${c.name}   ${c.description}`}</Text>
          : <Text key={c.name}>{`  /${c.name}   ${c.description}`}</Text>,
      )}
      {overflow ? <Text dimColor>{`  +${moreCount} more`}</Text> : null}
    </Box>
  );
}
