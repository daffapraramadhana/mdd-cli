// src/ui/theme.ts
// Color themes for the TUI. Colors are hex strings (ink renders them via chalk).

export interface Theme {
  name: string;
  user: string;      // "You" label
  assistant: string; // "MDD" label + streaming
  accent: string;    // input border, bullets
  toolOk: string;
  toolError: string;
  toolRun: string;
  code: string;      // code-block border/text
  gradient: [string, string, string]; // banner top → middle → bottom
}

export const THEMES: Record<string, Theme> = {
  neon: {
    name: 'neon',
    user: '#22d3ee',
    assistant: '#c084fc',
    accent: '#a855f7',
    toolOk: '#4ade80',
    toolError: '#f87171',
    toolRun: '#9ca3af',
    code: '#6b7280',
    gradient: ['#a855f7', '#d946ef', '#ec4899'],
  },
  ocean: {
    name: 'ocean',
    user: '#38bdf8',
    assistant: '#22d3ee',
    accent: '#0ea5e9',
    toolOk: '#34d399',
    toolError: '#fb7185',
    toolRun: '#94a3b8',
    code: '#64748b',
    gradient: ['#0ea5e9', '#22d3ee', '#2dd4bf'],
  },
  mono: {
    name: 'mono',
    user: '#e5e5e5',
    assistant: '#ffffff',
    accent: '#a3a3a3',
    toolOk: '#d4d4d4',
    toolError: '#fca5a5',
    toolRun: '#737373',
    code: '#737373',
    gradient: ['#e5e5e5', '#a3a3a3', '#737373'],
  },
};

export const THEME_NAMES = Object.keys(THEMES);
export const DEFAULT_THEME = 'neon';

export function getTheme(name: string | undefined): Theme {
  return (name && THEMES[name]) || THEMES[DEFAULT_THEME];
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** `count` interpolated RGB colors spread across the given hex stops. */
export function gradientColors(count: number, stops: string[]): RGB[] {
  const rgbs = stops.map(hexToRgb);
  if (count <= 1) return [rgbs[0]];
  const out: RGB[] = [];
  for (let i = 0; i < count; i++) {
    const p = (i / (count - 1)) * (rgbs.length - 1);
    const lo = Math.floor(p);
    const hi = Math.min(lo + 1, rgbs.length - 1);
    const t = p - lo;
    out.push([lerp(rgbs[lo][0], rgbs[hi][0], t), lerp(rgbs[lo][1], rgbs[hi][1], t), lerp(rgbs[lo][2], rgbs[hi][2], t)]);
  }
  return out;
}

/** Wrap each line of `text` in a 24-bit color from a vertical gradient. */
export function gradientText(text: string, stops: string[]): string {
  const lines = text.split('\n');
  const colors = gradientColors(lines.length, stops);
  return lines
    .map((line, i) => {
      const [r, g, b] = colors[i] ?? colors[colors.length - 1];
      return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
    })
    .join('\n');
}
