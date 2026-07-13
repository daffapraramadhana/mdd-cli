// src/ui/markdown.tsx
// A focused markdown renderer for the terminal: fenced code blocks, inline code,
// bold, headings, and bullet lists. Not a full CommonMark engine.
import { Box, Text } from 'ink';

export type MdBlock = { type: 'code'; lines: string[] } | { type: 'text'; content: string };

/** Split text into fenced-code blocks and everything else. */
export function splitBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = text.split('\n');
  let textBuf: string[] = [];
  const flush = (): void => {
    if (textBuf.length) { out.push({ type: 'text', content: textBuf.join('\n') }); textBuf = []; }
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      flush();
      i++; // skip opening fence
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++; // skip closing fence
      out.push({ type: 'code', lines: code });
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  flush();
  return out;
}

export interface InlineToken { text: string; bold?: boolean; code?: boolean; }

/** Tokenize a line into plain / **bold** / `code` runs. */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) tokens.push({ text: m[2], code: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  if (tokens.length === 0) tokens.push({ text: '' });
  return tokens;
}

function Line({ line }: { line: string }) {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return <Text bold>{renderTokens(parseInline(heading[1]))}</Text>;
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return (
      <Text>
        {bullet[1]}
        <Text color="magenta">• </Text>
        {renderTokens(parseInline(bullet[2]))}
      </Text>
    );
  }
  return <Text>{renderTokens(parseInline(line))}</Text>;
}

function renderTokens(tokens: InlineToken[]) {
  return tokens.map((t, i) => {
    if (t.code) return <Text key={i} color="cyan">{t.text}</Text>;
    if (t.bold) return <Text key={i} bold>{t.text}</Text>;
    return <Text key={i}>{t.text}</Text>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) =>
        b.type === 'code' ? (
          <Box key={i} flexDirection="column" borderStyle="round" borderColor="gray" borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
            {(b.lines.length ? b.lines : ['']).map((l, j) => <Text key={j} color="gray">{l}</Text>)}
          </Box>
        ) : (
          <Box key={i} flexDirection="column">
            {b.content.split('\n').map((l, j) => <Line key={j} line={l} />)}
          </Box>
        ),
      )}
    </Box>
  );
}
