import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Text, Static, useStdout, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { sanitizeInput } from './scroll.js';
import type { UiStore, TranscriptItem } from './store.js';
import { formatStatus, formatPath } from './banner.js';
import { formatToolCall, toolIcon } from './format.js';
import { Markdown } from './markdown.js';
import { getTheme, type Theme } from './theme.js';
import { spinnerFrame, thinkingDots, cursorFrame } from './spinner.js';
import { SelectList } from './select.js';
import { Header } from './header.js';
import { VERSION } from '../version.js';
import { formatUsage } from '../usage.js';
import { formatQuota } from '../quota.js';
import { createPasteState, applyChange, expandPastes } from './paste.js';
import { createAttachState, detectImageInsert, imageLabel, stripImageTokens } from './attach.js';
import { CommandMenu } from './command-menu.js';
import { filterSlashCommands, type SlashCommand } from './slash-commands.js';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const GUTTER = 5;
const HINTS = '/model  /plugin  /resume  /theme  /help    shift+tab cycle mode';
const fmtElapsed = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

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

function ToolLine({ marker, color, text, ms, elapsed, preview, rail }: { marker: string; color?: string; text: string; ms?: number; elapsed?: string; preview?: string; rail?: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={GUTTER} flexShrink={0}><Text dimColor>{rail ? '  │  ' : ' '}</Text></Box>
        <Text color={color}>{`${marker} ${text}`}</Text>
        {ms !== undefined ? <Text dimColor>{`  ${ms}ms`}</Text> : null}
        {elapsed ? <Text dimColor>{`  ${elapsed}`}</Text> : null}
      </Box>
      {preview ? (
        <Box>
          <Box width={GUTTER} flexShrink={0}><Text dimColor>{rail ? '  │  ' : ' '}</Text></Box>
          <Text dimColor>{preview}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function renderItem(item: TranscriptItem, key: number, userNum: number, theme: Theme, cont: boolean) {
  if (item.kind === 'user') {
    return (
      <Box key={key} flexDirection="column" marginTop={1}>
        {userNum > 1 ? <Text dimColor>{'· '.repeat(24).trimEnd()}</Text> : null}
        <Box>
          <Box width={GUTTER} flexShrink={0}><Text color={theme.user} bold>You</Text></Box>
          <Text>{item.text}</Text>
          <Text dimColor>{`  #${userNum}`}</Text>
        </Box>
      </Box>
    );
  }
  if (item.kind === 'assistant') {
    // `cont` = this chunk was flushed from the same reply as the item above it (see
    // splitStreamable): blank the gutter so one reply reads as one message, not many "MDD"s.
    return <Row key={key} label={cont ? '' : 'MDD'} color={theme.assistant}><Markdown text={item.text} theme={theme} /></Row>;
  }
  if (item.kind === 'system') {
    return (
      <Box key={key} marginTop={1}>
        <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
        <Text dimColor>{item.text}</Text>
      </Box>
    );
  }
  if (item.kind === 'reasoning') {
    return (
      <Box key={key} marginTop={1}>
        <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
        <Text dimColor>{`✻ Thought for ${(item.durationMs / 1000).toFixed(1)}s`}</Text>
      </Box>
    );
  }
  const ok = item.status === 'ok';
  return (
    <ToolLine key={key} marker={ok ? '✓' : '✗'} color={ok ? theme.toolOk : theme.toolError}
      text={`${toolIcon(item.name)} ${formatToolCall(item.name, item.input)}`} ms={item.durationMs}
      preview={item.preview} rail />
  );
}

// The whole REPL renders into the NORMAL terminal buffer: committed history goes through
// <Static> (printed once, scrolled natively by the terminal — smooth, mouse/trackpad, and
// selectable), while the live streaming region, input, and status bar re-render in place at
// the bottom. `showHeader` prints the banner once as the first Static item so it sits at the
// top of scrollback (like Claude Code) instead of being frozen in an alternate screen.
export interface SubmitInput { display: string; text: string; imagePaths: string[] }

export function App({ store, onSubmit, showHeader = false, onCycleMode, commands = [] }: { store: UiStore; onSubmit: (input: SubmitInput) => void; showHeader?: boolean; onCycleMode?: () => void; commands?: SlashCommand[] }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [tick, setTick] = useState(0);
  const pasteRef = useRef(createPasteState());
  const attachRef = useRef(createAttachState());
  // Mirror of `value`, updated synchronously in onChange. ink-text-input's onSubmit hands us a
  // stale `originalValue` for a render-window after we rewrite its controlled value (paste
  // collapse), so we submit from this ref — the source of truth — not from that argument.
  const valueRef = useRef('');
  const setInput = (next: string): void => { valueRef.current = next; setValue(next); };
  const { stdout } = useStdout();
  const width = Math.max(8, (stdout?.columns ?? 80));

  const theme = getTheme(state.themeName);
  const animating = state.activeTool !== null || state.status === 'busy' || state.streaming !== '';

  const menuCommands = filterSlashCommands(commands, value);
  const menuOpen =
    state.status === 'idle' &&
    state.pendingChoice === null &&
    state.pendingPrompt === null &&
    !menuDismissed &&
    menuCommands.length > 0;
  // Keep the highlight in range as the filtered set shrinks/grows.
  const clampedHighlight = menuCommands.length ? Math.min(highlight, menuCommands.length - 1) : 0;

  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick((n) => n + 1), 90);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [animating]);

  // Esc interrupts an in-flight turn — but only when nothing else owns Esc (no select/prompt open).
  useInput((_input, key) => {
    if (menuOpen) {
      const len = menuCommands.length;
      if (key.downArrow) { setHighlight((h) => (Math.min(h, len - 1) + 1) % len); return; }
      if (key.upArrow) { setHighlight((h) => (Math.min(h, len - 1) - 1 + len) % len); return; }
      if (key.tab && !key.shift) {
        setInput(`/${menuCommands[clampedHighlight].name} `);
        setHighlight(0);
        setInputEpoch((e) => e + 1); // remount TextInput so its cursor moves to the end
        return;
      }
      if (key.escape) { setMenuDismissed(true); return; }
    }
    if (key.tab && key.shift && state.pendingChoice === null && state.pendingPrompt === null) {
      onCycleMode?.();
      return;
    }
    if (key.escape && state.status === 'busy' && state.pendingChoice === null && state.pendingPrompt === null) {
      store.requestAbort();
    }
  });

  const handleSubmit = () => {
    // Read the live value from the ref, not ink-text-input's (possibly stale) onSubmit argument.
    const current = valueRef.current;
    if (state.pendingPrompt !== null) { setInput(''); pasteRef.current = createPasteState(); attachRef.current = createAttachState(); store.resolvePrompt(current); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    // Command menu open: Enter runs the highlighted command (not the raw `/…` text the user
    // has typed so far). Tab is the "complete, keep editing for args" path; Enter is "pick it".
    if (menuOpen) {
      const picked = `/${menuCommands[clampedHighlight].name}`;
      setInput('');
      pasteRef.current = createPasteState();
      attachRef.current = createAttachState();
      onSubmit({ display: picked, text: picked, imagePaths: [] });
      return;
    }
    const display = current.trim();
    const pasteMap = pasteRef.current.map;
    const imagePaths = [...attachRef.current.map.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    setInput('');
    pasteRef.current = createPasteState();
    attachRef.current = createAttachState();
    // Model text: expand paste chips to full text, remove image chips (images ride as separate blocks).
    const text = stripImageTokens(expandPastes(display, pasteMap)).trim();
    if (display) onSubmit({ display, text, imagePaths });
  };

  const thinking = state.status === 'busy' && state.pendingPrompt === null && !state.streaming && !state.activeTool && !state.reasoning;
  const meta = state.meta;

  let userNum = 0;
  const allEls = state.transcript.map((item, i) => {
    if (item.kind === 'user') userNum += 1;
    // An assistant item directly after another is a flushed continuation of the same reply.
    const cont = item.kind === 'assistant' && state.transcript[i - 1]?.kind === 'assistant';
    return renderItem(item, i, userNum, theme, cont);
  });
  // The live streaming tail continues the reply if we've already flushed a chunk of it (the last
  // committed item is assistant) — so it too drops the repeated "MDD" gutter.
  const streamCont = state.transcript.at(-1)?.kind === 'assistant';
  const staticItems = showHeader
    ? [<Header key="hdr" theme={theme} version={VERSION} width={width} />, ...allEls]
    : allEls;

  const liveRows = (
    <>
      {state.reasoning ? (
        <Row label="MDD" color={theme.assistant}>
          <Box flexDirection="column">
            <Text dimColor>{`${spinnerFrame(tick)} Thinking${thinkingDots(tick)}`}</Text>
            <Text dimColor italic>{state.reasoning.split('\n').slice(-8).join('\n')}</Text>
          </Box>
        </Row>
      ) : null}
      {state.streaming ? (
        <Row label={streamCont ? '' : 'MDD'} color={theme.assistant}>
          <Box flexDirection="column">
            <Markdown text={state.streaming} theme={theme} />
            <Text color={theme.assistant}>{cursorFrame(tick)}</Text>
            {state.turnStartedAt !== null ? <Text dimColor>{`  ${fmtElapsed(Date.now() - state.turnStartedAt)}  esc to interrupt`}</Text> : null}
          </Box>
        </Row>
      ) : null}
      {state.activeTool ? (
        <ToolLine marker={spinnerFrame(tick)} color={theme.toolRun} rail
          elapsed={fmtElapsed(Date.now() - state.activeTool.startedAt)}
          text={`${toolIcon(state.activeTool.name)} ${formatToolCall(state.activeTool.name, state.activeTool.input)}`} />
      ) : null}
      {thinking ? (
        <Row label="MDD" color={theme.assistant}>
          <Text dimColor>
            {`${spinnerFrame(tick)} thinking${thinkingDots(tick)}`}
            {state.turnStartedAt !== null ? `   ${fmtElapsed(Date.now() - state.turnStartedAt)}` : ''}
            {'   esc to interrupt'}
          </Text>
        </Row>
      ) : null}
    </>
  );

  // Claude-style input chrome: a full-width horizontal rule, then a `>` prompt that stays pinned
  // at the bottom at all times — even mid-turn (busy). While a turn runs, keystrokes still edit
  // the draft, but Enter is held (see handleSubmit) so nothing is sent until the turn finishes.
  const bottom = state.pendingChoice ? (
    <SelectList
      spec={state.pendingChoice}
      onResolve={(r) => store.resolveChoice(r)}
      accent={theme.accent}
    />
  ) : (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(width)}</Text>
      {menuOpen ? (
        <Box paddingLeft={1}>
          <CommandMenu commands={menuCommands} highlight={clampedHighlight} theme={theme} />
        </Box>
      ) : null}
      <Box paddingLeft={1}>
        <Text color={theme.accent}>{'> '}</Text>
        {state.pendingPrompt !== null ? <Text>{state.pendingPrompt} </Text> : null}
        <TextInput
          key={`input-${inputEpoch}`}
          value={value}
          onChange={(next) => {
            setMenuDismissed(false);
            setHighlight(0);
            const prev = valueRef.current;
            const r = applyChange(prev, sanitizeInput(next), pasteRef.current, Date.now());
            pasteRef.current = r.state;
            // Image attach: if the just-inserted chunk is an existing image file, collapse it to a chip.
            const cand = detectImageInsert(prev, r.value);
            if (cand) {
              const abs = resolve(process.cwd(), cand.path);
              let exists = false;
              try { exists = statSync(abs).isFile(); } catch { exists = false; }
              if (exists) {
                const n = attachRef.current.count + 1;
                const nextMap = new Map(attachRef.current.map); nextMap.set(n, abs);
                attachRef.current = { map: nextMap, count: n };
                setInput(r.value.slice(0, cand.at) + imageLabel(n, abs) + r.value.slice(cand.at + cand.len));
                return;
              }
            }
            setInput(r.value);
          }}
          onSubmit={handleSubmit}
        />
        {/* Own dim hint instead of ink-text-input's placeholder, so the cursor is a clean
            block and not an inverted first letter ("A"). Only when idle + empty. */}
        {state.status === 'idle' && state.pendingPrompt === null && value === '' ? <Text dimColor>Ask anything…</Text> : null}
      </Box>
      <Text dimColor>{'─'.repeat(width)}</Text>
    </Box>
  );

  let statusBar: ReactNode = null;
  if (meta) {
    const usageText = state.usage.inputTokens + state.usage.outputTokens > 0
      ? `  · ${formatUsage(state.usage, meta.model)}`
      : '';
    const pathText = `${formatPath(meta)} · ctrl-c exit`;
    // Measure the two halves against the terminal: 'mdd' (3) + '  ' (2) + status + usage on the
    // left, the path line on the right, plus a 1-col min gap and paddingX (2). When they don't
    // both fit on one line, stack them instead of letting space-between collide them (as it did
    // at narrow widths — `claude-opus-4-8~/Desktop…`).
    const oneLine = 3 + 2 + formatStatus(meta).length + usageText.length + 1 + pathText.length + 2 <= width;
    const metaLine = (
      <Text>
        <Text color={theme.accent} bold>mdd</Text>
        <Text dimColor>{`  ${formatStatus(meta)}`}</Text>
        {usageText ? <Text dimColor>{usageText}</Text> : null}
      </Text>
    );
    const pathLine = <Text dimColor wrap="wrap">{pathText}</Text>;
    statusBar = (
      <Box flexDirection="column">
        {oneLine ? (
          // Metadata on the left, cwd + exit hint pushed to the right edge.
          <Box width={width} paddingX={1} justifyContent="space-between">{metaLine}{pathLine}</Box>
        ) : (
          <>
            <Box paddingX={1}>{metaLine}</Box>
            <Box paddingX={1}>{pathLine}</Box>
          </>
        )}
        {/* Command hints on their own dim line, indented to align with the input. */}
        <Box paddingX={1}><Text dimColor>{HINTS}</Text></Box>
        {(() => {
          const q = formatQuota(state.quota, meta.model);
          return q ? (
            <Box paddingX={1}>
              <Text color={q.warn ? theme.toolError : undefined} dimColor={!q.warn}>{`⏳ ${q.text}`}</Text>
            </Box>
          ) : null;
        })()}
        {state.update?.stale ? (
          <Box paddingX={1}>
            <Text color={theme.accent}>{`↑ update available: v${state.update.latest} · npm i -g mdd-cli`}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(el) => el}</Static>
      {liveRows}
      {bottom ? <Box marginTop={1}>{bottom}</Box> : null}
      {statusBar ? <Box marginTop={state.pendingChoice ? 1 : 0}>{statusBar}</Box> : null}
    </Box>
  );
}
