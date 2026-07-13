// src/ui/header.tsx
import { Box, Text } from 'ink';
import type { SessionMeta } from './banner.js';
import type { Theme } from './theme.js';

export function Header({ meta, theme, version }: { meta: SessionMeta | null; theme: Theme; version: string }) {
  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} justifyContent="space-between">
      <Box flexDirection="column">
        <Text color={theme.assistant} bold>mdd</Text>
        <Text dimColor>{`terminal coding assistant · v${version}`}</Text>
        {meta ? (
          <Text>
            <Text color={theme.user}>{meta.provider}</Text>
            <Text dimColor>{` · ${meta.model}`}</Text>
          </Text>
        ) : null}
        {meta ? <Text dimColor>{`${meta.cwd}${meta.branch ? ` (${meta.branch})` : ''}`}</Text> : null}
      </Box>
      <Box flexDirection="column">
        <Text color={theme.accent} bold>Commands</Text>
        <Text dimColor>/models  pick a model</Text>
        <Text dimColor>/theme   switch theme</Text>
        <Text dimColor>/help    all commands</Text>
      </Box>
    </Box>
  );
}
