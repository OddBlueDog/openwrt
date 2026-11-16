// A theme in the W3C Design Tokens Community Group format (2025.10), so it can
// go to design tools and come back. Groups and names match the CSS: the token
// color.card is var(--card), dimension.radius-lg is the rounded-lg class.
import { COLOR_TOKENS, RADII, TEXT_SIZES, type Theme } from './contract.ts';
import { schemesOf } from './css.ts';

interface Token {
  $type: string;
  $value: unknown;
  $description?: string;
}
type Group = Record<string, Token>;

function color(css: string): unknown {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return {
      colorSpace: 'srgb',
      components: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255],
      hex: css.toLowerCase(),
    };
  }
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(css);
  if (m === null) throw new Error(`can't export colour ${css}`);
  const value: { colorSpace: string; components: number[]; alpha?: number } = {
    colorSpace: 'oklch',
    components: [Number(m[1]) / 100, Number(m[2]), Number(m[3])],
  };
  if (m[4] !== undefined) value.alpha = Number(m[4]);
  return value;
}

function dimension(css: string): unknown {
  const m = /^(-?[\d.]+)(rem|px)?$/.exec(css);
  if (m === null) throw new Error(`can't export dimension ${css}`);
  return { value: Number(m[1]), unit: m[2] ?? 'px' };
}

function duration(css: string): unknown {
  const m = /^([\d.]+)ms$/.exec(css);
  if (m === null) throw new Error(`can't export duration ${css}`);
  return { value: Number(m[1]), unit: 'ms' };
}

function bezier(css: string): unknown {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(css);
  if (m?.[1] === undefined) throw new Error(`can't export easing ${css}`);
  return m[1].split(',').map((x) => Number(x.trim()));
}

function family(css: string): string[] {
  return css.split(',').map((f) => f.trim().replace(/^'(.*)'$/, '$1'));
}

/** One scheme of a theme as a DTCG token file. */
export function toDtcg(theme: Theme, scheme: 'light' | 'dark'): Record<string, Group | string> {
  const s = schemesOf(theme)[scheme];
  const colors: Group = {};
  for (const t of COLOR_TOKENS) colors[t] = { $type: 'color', $value: color(s.color[t]) };
  const dims: Group = {};
  for (const size of TEXT_SIZES) {
    dims[`text-${size}`] = { $type: 'dimension', $value: dimension(theme.type.scale[size].size) };
    dims[`text-${size}-leading`] = { $type: 'dimension', $value: dimension(theme.type.scale[size].leading) };
  }
  for (const r of RADII) dims[`radius-${r}`] = { $type: 'dimension', $value: dimension(theme.shape.radius[r]) };
  dims['space'] = { $type: 'dimension', $value: dimension(theme.density.space), $description: 'the spacing unit' };
  return {
    $description: `${theme.name} (${scheme}), exported from MilkFlint's router interface`,
    color: colors,
    dimension: dims,
    font: {
      sans: { $type: 'fontFamily', $value: family(theme.type.sans) },
      mono: { $type: 'fontFamily', $value: family(theme.type.mono) },
    },
    motion: {
      'duration-fast': { $type: 'duration', $value: duration(theme.motion.fast) },
      'duration-base': { $type: 'duration', $value: duration(theme.motion.base) },
      'duration-slow': { $type: 'duration', $value: duration(theme.motion.slow) },
      'ease-standard': { $type: 'cubicBezier', $value: bezier(theme.motion.standard) },
      'ease-enter': { $type: 'cubicBezier', $value: bezier(theme.motion.enter) },
    },
  };
}
