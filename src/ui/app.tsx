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
import { createPasteState, applyChange, expandPastes } from './paste.js';
import { createAttachState, detectImageInsert, imageLabel, stripImageTokens } from './attach.js';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const GUTTER = 5;
const HINTS = '/model  /resume  /theme  /help  /exit';
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

function renderItem(item: TranscriptItem, key: number, userNum: number, theme: Theme) {
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
    return <Row key={key} label="MDD" color={theme.assistant}><Markdown text={item.text} theme={theme} /></Row>;
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

export function App({ store, onSubmit, showHeader = false }: { store: UiStore; onSubmit: (input: SubmitInput) => void; showHeader?: boolean }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [value, setValue] = useState('');
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

  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick((n) => n + 1), 90);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [animating]);

  // Esc interrupts an in-flight turn — but only when nothing else owns Esc (no select/prompt open).
  useInput((_input, key) => {
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
    return renderItem(item, i, userNum, theme);
  });
  const staticItems = showHeader
    ? [<Header key="hdr" theme={theme} version={VERSION} width={width} />, ...allEls]
    : allEls;

  const liveRows = (
    <>
      {state.reasoning ? (
        <Row label="MDD" color={theme.assistant}>
          <Box flexDirection="column">
            <Text dimColor>{`✻ Thinking${thinkingDots(tick)}`}</Text>
            <Text dimColor italic>{state.reasoning.split('\n').slice(-8).join('\n')}</Text>
          </Box>
        </Row>
      ) : null}
      {state.streaming ? (
        <Row label="MDD" color={theme.assistant}>
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
            {`thinking${thinkingDots(tick)}`}
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
      <Box paddingLeft={1}>
        <Text color={theme.accent}>{'> '}</Text>
        {state.pendingPrompt !== null ? <Text>{state.pendingPrompt} </Text> : null}
        <TextInput
          value={value}
          onChange={(next) => {
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

  const statusBar = meta ? (
    <Box flexDirection="column">
      {/* Metadata on the left, cwd + exit hint pushed to the right edge. */}
      <Box width={width} paddingX={1} justifyContent="space-between">
        <Text>
          <Text color={theme.accent} bold>mdd</Text>
          <Text dimColor>{`  ${formatStatus(meta)}`}</Text>
          {state.usage.inputTokens + state.usage.outputTokens > 0
            ? <Text dimColor>{`  · ${formatUsage(state.usage, meta.model)}`}</Text>
            : null}
        </Text>
        <Text dimColor>{`${formatPath(meta)} · ctrl-c exit`}</Text>
      </Box>
      {/* Command hints on their own dim line, indented to align with the input. */}
      <Box paddingX={1}><Text dimColor>{HINTS}</Text></Box>
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(el) => el}</Static>
      {liveRows}
      {bottom ? <Box marginTop={1}>{bottom}</Box> : null}
      {statusBar ? <Box marginTop={state.pendingChoice ? 1 : 0}>{statusBar}</Box> : null}
    </Box>
  );
}
