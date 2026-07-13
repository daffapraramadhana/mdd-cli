// src/ui/highlight.ts
// Dependency-free, regex-based syntax highlighting for the handful of languages that
// actually show up in this assistant's replies. Approximate, not a real lexer: a
// mis-tokenization degrades to the quiet `base` color, never to garbage, and it never
// throws. Unknown languages return a single base-colored token (the old flat look).

export interface HlPalette {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  fn: string;
  base: string;
}

export interface HlToken {
  text: string;
  color?: string;
}

type ColorKey = keyof HlPalette;
interface Rule { re: string; color: ColorKey }

// Every rule contributes exactly ONE capturing group (its outer wrapper), so the matched
// alternative is `groupIndex - 1`. Inner groups MUST be non-capturing `(?:…)`.
function lex(code: string, rules: Rule[], palette: HlPalette): HlToken[] {
  if (!code) return [{ text: '', color: palette.base }];
  const combined = new RegExp(rules.map((r) => `(${r.re})`).join('|'), 'g');
  const out: HlToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(code)) !== null) {
    if (m[0] === '') { combined.lastIndex++; continue; } // zero-width guard
    if (m.index > last) out.push({ text: code.slice(last, m.index), color: palette.base });
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    out.push({ text: m[0], color: palette[rules[gi].color] });
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push({ text: code.slice(last), color: palette.base });
  return out.length ? out : [{ text: code, color: palette.base }];
}

const STR_DQ = `"(?:[^"\\\\]|\\\\.)*"`;
const STR_SQ = `'(?:[^'\\\\]|\\\\.)*'`;
const STR_TICK = '`(?:[^`\\\\]|\\\\.)*`';

const JS: Rule[] = [
  { re: `//[^\\n]*|/\\*[\\s\\S]*?\\*/`, color: 'comment' },
  { re: `${STR_DQ}|${STR_SQ}|${STR_TICK}`, color: 'string' },
  { re: `\\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|from|export|default|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|null|undefined|true|false|interface|type|enum|implements|public|private|protected|readonly|static|get|set|namespace|as|satisfies|keyof)\\b`, color: 'keyword' },
  { re: `\\b\\d[\\d_]*(?:\\.\\d+)?\\b`, color: 'number' },
  { re: `\\b[A-Za-z_$][\\w$]*(?=\\s*\\()`, color: 'fn' },
];

const JSON_RULES: Rule[] = [
  { re: STR_DQ, color: 'string' },
  { re: `\\b(?:true|false|null)\\b`, color: 'keyword' },
  { re: `-?\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b`, color: 'number' },
];

const SH: Rule[] = [
  { re: `#[^\\n]*`, color: 'comment' },
  { re: `${STR_DQ}|'[^']*'`, color: 'string' },
  { re: `\\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|echo|cd|export|local|return|exit|set|unset|read|source|sudo|npm|npx|git|node)\\b`, color: 'keyword' },
  { re: `--?[A-Za-z][\\w-]*`, color: 'number' },
];

const PY: Rule[] = [
  { re: `#[^\\n]*`, color: 'comment' },
  { re: `"""[\\s\\S]*?"""|'''[\\s\\S]*?'''|${STR_DQ}|${STR_SQ}`, color: 'string' },
  { re: `@[A-Za-z_][\\w.]*`, color: 'fn' },
  { re: `\\b(?:def|return|if|elif|else|for|while|break|continue|class|import|from|as|pass|lambda|yield|with|try|except|finally|raise|True|False|None|and|or|not|in|is|global|nonlocal|async|await|del|assert|print)\\b`, color: 'keyword' },
  { re: `\\b\\d[\\d_]*(?:\\.\\d+)?\\b`, color: 'number' },
  { re: `\\b[A-Za-z_]\\w*(?=\\s*\\()`, color: 'fn' },
];

const LANGS: Record<string, Rule[]> = {
  ts: JS, js: JS, tsx: JS, jsx: JS, javascript: JS, typescript: JS,
  json: JSON_RULES,
  sh: SH, bash: SH, shell: SH, zsh: SH, console: SH,
  py: PY, python: PY,
};

/** Highlight `code` for `lang`; unknown/null lang → one base-colored token. Never throws. */
export function highlight(code: string, lang: string | null, palette: HlPalette): HlToken[] {
  const rules = lang ? LANGS[lang.toLowerCase()] : undefined;
  if (!rules) return [{ text: code, color: palette.base }];
  try {
    return lex(code, rules, palette);
  } catch {
    return [{ text: code, color: palette.base }];
  }
}
