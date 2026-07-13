// src/ui/header.tsx
import { Box, Text } from 'ink';
import { LOGO } from './banner.js';
import { gradientHexes, type Theme } from './theme.js';

// Layout constants used to pick a responsive header shape (all in terminal columns).
const CHROME = 4; // round border (2) + paddingX=1 on each side (2)
const GAP = 2; // marginLeft between the logo and the Commands column
const LOGO_WIDTH = Math.max(...LOGO.map((l) => l.length));
const CMD_WIDTH = 21; // widest command hint line, e.g. "/models  pick a model"

/** The big ANSI-Shadow MDD logo, each row tinted along the theme gradient. */
function Logo({ theme }: { theme: Theme }) {
  const colors = gradientHexes(LOGO.length, theme.gradient);
  return (
    // flexShrink=0 so a tight two-column layout can never squeeze the logo into wrapping (which
    // shreds the block art). When it won't fit we drop to a stacked/compact shape instead.
    <Box flexDirection="column" flexShrink={0}>
      {LOGO.map((line, i) => (
        <Text key={i} color={colors[i]} bold wrap="truncate">{line}</Text>
      ))}
    </Box>
  );
}

/** A one-line wordmark for terminals too narrow to hold the block-art logo. */
function CompactLogo({ theme }: { theme: Theme }) {
  return <Text color={gradientHexes(1, theme.gradient)[0]} bold>MDD</Text>;
}

function Commands({ theme, marginTop = 0 }: { theme: Theme; marginTop?: number }) {
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={marginTop}>
      <Text color={theme.accent} bold>Commands</Text>
      <Text dimColor>/models  pick a model</Text>
      <Text dimColor>/theme   switch theme</Text>
      <Text dimColor>/help    all commands</Text>
    </Box>
  );
}

// A one-time welcome banner printed at the top of the session. Live provider/model/cwd
// lives in the bottom status bar (which updates on /model, /theme, /provider).
// `width` is the terminal column count (passed in from App). A `<Static>` child does NOT stretch
// to the terminal with `width="100%"` — Ink sizes the static subtree to content — so we set an
// explicit numeric width to span full width and match the input separator rule below.
//
// Responsive shapes, chosen by available width:
//   • wide    — logo left, Commands column right (the classic layout)
//   • narrow  — logo on top, Commands stacked below it (both still full)
//   • compact — a small "MDD" wordmark instead of block art, so nothing wraps/shreds
export function Header({ theme, version, width }: { theme: Theme; version: string; width: number }) {
  const inner = width - CHROME;
  const sideBySide = inner >= LOGO_WIDTH + GAP + CMD_WIDTH;
  const logoFits = inner >= LOGO_WIDTH;

  const subtitle = (
    <>
      <Text dimColor wrap="wrap">{`multidaya terminal coding assistant · v${version}`}</Text>
      <Text dimColor wrap="wrap">psst.. this is a very early version — any feedback and improvements are very welcome · deepoy (ping me for any question)</Text>
    </>
  );

  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} justifyContent="space-between" width={width}>
      <Box flexDirection="column">
        {logoFits ? <Logo theme={theme} /> : <CompactLogo theme={theme} />}
        {subtitle}
        {!sideBySide && <Commands theme={theme} marginTop={1} />}
      </Box>
      {sideBySide && (
        <Box marginLeft={GAP} flexShrink={0}>
          <Commands theme={theme} />
        </Box>
      )}
    </Box>
  );
}
