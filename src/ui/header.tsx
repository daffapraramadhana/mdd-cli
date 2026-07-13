// src/ui/header.tsx
import { Box, Text } from 'ink';
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

// A one-time welcome banner printed at the top of the session. Live provider/model/cwd
// lives in the bottom status bar (which updates on /model, /theme, /provider).
// `width` is the terminal column count (passed in from App). A `<Static>` child does NOT stretch
// to the terminal with `width="100%"` — Ink sizes the static subtree to content — so we set an
// explicit numeric width to span full width and match the input separator rule below.
export function Header({ theme, version, width }: { theme: Theme; version: string; width: number }) {
  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} justifyContent="space-between" width={width}>
      <Box flexDirection="column">
        <Logo theme={theme} />
        <Text dimColor>{`multidaya terminal coding assistant · v${version}`}</Text>
        <Text dimColor>psst.. this is a very early version — any feedback and improvements are very welcome · deepoy (ping me for any question)</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2} flexShrink={0}>
        <Text color={theme.accent} bold>Commands</Text>
        <Text dimColor>/models  pick a model</Text>
        <Text dimColor>/theme   switch theme</Text>
        <Text dimColor>/help    all commands</Text>
      </Box>
    </Box>
  );
}
