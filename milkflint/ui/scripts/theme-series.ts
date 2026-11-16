// Finds six chart colours for a new theme: one per hue family (blue and
// orange first: the traffic charts' upload and download), each inside sRGB, each at 3:1 or
// more on the theme's panel colour, and as far apart as possible for typical
// vision and for protanopia, deuteranopia and tritanopia. Paste the result into
// the theme; the theme tests check it again.
//
//   node scripts/theme-series.ts 'oklch(100% 0 0)' 36 66      # a light panel
//   node scripts/theme-series.ts 'oklch(18.6% 0.013 258)' 62 88   # a dark one
//
// The two numbers bound the lightness (in %) the search may use.
import { contrast, distance, type Vision } from '../src/theme/color.ts';

const [panel = 'oklch(100% 0 0)', low = '36', high = '66'] = process.argv.slice(2);
const lightness: readonly [number, number] = [Number(low), Number(high)];
const families: readonly (readonly [number, number])[] = [
  [250, 268], // blue (chart-1): upload
  [35, 62], // orange (chart-2): download
  [170, 205], // teal
  [285, 318], // purple
  [85, 130], // olive
  [335, 375], // wine
];
const visions: readonly Vision[] = ['typical', 'protanopia', 'deuteranopia', 'tritanopia'];

function inGamut(l: number, c: number, hue: number): boolean {
  const h = (hue * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const L = l / 100;
  const lc = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
  return rgb.every((x) => x >= 0 && x <= 1);
}

const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

function pick([hlo, hhi]: readonly [number, number]): string {
  for (;;) {
    const l = Math.round(between(lightness[0], lightness[1]) * 2) / 2;
    const c = Math.round(between(0.08, 0.2) * 200) / 200;
    const h = Math.round(between(hlo, hhi)) % 360;
    if (!inGamut(l, c, h)) continue;
    const css = `oklch(${l}% ${c} ${h})`;
    if (contrast(css, panel) >= 3.1) return css;
  }
}

/** The closest two colours look, for the worst vision; download/upload count double. */
function spread(set: readonly string[]): number {
  let worst = Infinity;
  set.forEach((a, i) => {
    set.forEach((b, j) => {
      if (j <= i) return;
      for (const v of visions) worst = Math.min(worst, distance(a, b, v) * (i === 0 && j === 1 ? 0.6 : 1));
    });
  });
  return worst;
}

let best = families.map(pick);
let score = spread(best);
for (let round = 0; round < 100_000; round++) {
  const next =
    round < 60_000 ? families.map(pick) : best.map((c, i) => (i === round % families.length ? pick(families[i] ?? [0, 360]) : c));
  const s = spread(next);
  if (s > score) {
    best = next;
    score = s;
  }
}
console.log(`closest pair: ${score.toFixed(3)} (the tests ask for 0.06, and 0.12 for download/upload)`);
for (const c of best) console.log(`${c}  ${contrast(c, panel).toFixed(2)}:1 on the panel`);
