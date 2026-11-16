// Colour arithmetic for the theme checks: OKLCH and hex to sRGB, WCAG
// contrast, OKLab distance, and how a colour looks with a colour-vision
// deficiency (Machado, Oliveira and Fernandes 2009, full severity).

type Rgb = readonly [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Linear-light sRGB of oklch(L C H [/ A]) or #rrggbb, gamut-clipped. Alpha is ignored. */
export function toLinearRgb(css: string): Rgb {
  const value = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
  }
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/i.exec(value);
  if (m === null) throw new Error(`not an oklch() or #rrggbb colour: ${css}`);
  const lightness = Number(m[1]) / (m[2] === '%' ? 100 : 1);
  const chroma = Number(m[3]);
  const hue = (Number(m[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

/** True when the colour carries transparency (an overlay, not a surface). */
export function hasAlpha(css: string): boolean {
  return /\/\s*[\d.]+%?\s*\)$/.test(css.trim());
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** WCAG 2 contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(toLinearRgb(a));
  const lb = luminance(toLinearRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toOklab(rgb: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]);
  const m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]);
  const s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export type Vision = 'typical' | 'protanopia' | 'deuteranopia' | 'tritanopia';

const MACHADO: Readonly<Record<Exclude<Vision, 'typical'>, readonly Rgb[]>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function seenAs(rgb: Rgb, vision: Vision): Rgb {
  if (vision === 'typical') return rgb;
  const [r0, r1, r2] = MACHADO[vision];
  if (r0 === undefined || r1 === undefined || r2 === undefined) return rgb;
  const row = (r: Rgb): number => clamp01(r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]);
  return [row(r0), row(r1), row(r2)];
}

/** How far apart two colours look (OKLab distance; about 0.1 is clearly different). */
export function distance(a: string, b: string, vision: Vision = 'typical'): number {
  const pa = toOklab(seenAs(toLinearRgb(a), vision));
  const pb = toOklab(seenAs(toLinearRgb(b), vision));
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

// Back from OKLab, for the Themes page's editor: a colour picked there, mixed
// or made lighter, written as #rrggbb (the picker's own format).

function fromOklab(lab: Rgb): Rgb {
  const [L, a, b] = lab;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hexOf(rgb: Rgb): string {
  const channel = (v: number): string => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** #rrggbb of any colour the themes use (gamut-clipped; alpha dropped). */
export function toHex(css: string): string {
  return hexOf(toLinearRgb(css));
}

/** `a` mixed with `b` in OKLab: `amount` of b, 0 to 1. */
export function mix(a: string, b: string, amount: number): string {
  const pa = toOklab(toLinearRgb(a));
  const pb = toOklab(toLinearRgb(b));
  const t = clamp01(amount);
  return hexOf(fromOklab([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]));
}

/** The same colour lighter (positive) or darker (negative), by OKLab lightness 0 to 1. */
export function shiftLightness(css: string, by: number): string {
  const [L, a, b] = toOklab(toLinearRgb(css));
  return hexOf(fromOklab([clamp01(L + by), a, b]));
}
