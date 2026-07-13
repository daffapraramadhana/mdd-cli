// src/ui/header.tsx
import { Box, Text } from 'ink';
import type { SessionMeta } from './banner.js';
import { LOGO } from './banner.js';
import { gradientHexes, type Theme } from './theme.js';

/** The big ANSI-Shadow MDD logo, each row tinted along the theme gradient. */
function Logo({ theme }: { theme: Theme }) {
  const colors = gradientHexes(LOGO.length, theme.gradient);
  return (
    <Box flexDirection="column">
      {LOGO.map((line, i) => (
        <Text key={i} color={colors[i]} bold>{line}</Text>
      ))}
    </Box>
  );
}

export function Header({ meta, theme, version }: { meta: SessionMeta | null; theme: Theme; version: string }) {
  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} justifyContent="space-between">
      <Box flexDirection="column">
        <Logo theme={theme} />
        <Text dimColor>{`terminal coding assistant · v${version}`}</Text>
        {meta ? (
          <Text>
            <Text color={theme.user}>{meta.provider}</Text>
            <Text dimColor>{` · ${meta.model}`}</Text>
          </Text>
        ) : null}
        {meta ? <Text dimColor>{`${meta.cwd}${meta.branch ? ` (${meta.branch})` : ''}`}</Text> : null}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text color={theme.accent} bold>Commands</Text>
        <Text dimColor>/models  pick a model</Text>
        <Text dimColor>/theme   switch theme</Text>
        <Text dimColor>/help    all commands</Text>
      </Box>
    </Box>
  );
}
