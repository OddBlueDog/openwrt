import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, distance, hasAlpha, luminance, toLinearRgb, type Vision } from '@/theme/color';
import { CHART_SERIES, COLOR_TOKENS, type ColorToken, ELEVATION_TOKENS, RADII, type Scheme, TEXT_SIZES } from '@/theme/contract';
import { schemesOf, themeCss } from '@/theme/css';
import { toDtcg } from '@/theme/dtcg';
import { DEFAULT_THEME_ID, themes } from '@/theme/themes';
import { MARK_PAIRS, TEXT_PAIRS, textMinimum } from '@/theme/checks';
import { solidCharts, standardPresentation } from '@/theme/defaults';

// Every theme, each of its schemes, plain and with prefers-contrast: more.
const cases = themes.flatMap((theme) => {
  const s = schemesOf(theme);
  return (['light', 'dark'] as const).flatMap((name) => {
    const scheme: Scheme = s[name];
    const plain = { label: `${theme.id} ${name}`, theme, color: scheme.color };
    if (scheme.more === undefined) return [plain];
    return [plain, { label: `${theme.id} ${name} (more contrast)`, theme, color: { ...scheme.color, ...scheme.more } }];
  });
});

test('themes: ids are unique and the default exists', () => {
  const ids = themes.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_THEME_ID));
  assert.ok(
    themes.some((t) => t.hidden !== true),
    'at least one theme is in the picker',
  );
  for (const t of themes) assert.match(t.id, /^[a-z][a-z0-9-]*$/);
});

test('themes: every scheme defines exactly the contract’s tokens', () => {
  for (const theme of themes) {
    for (const scheme of [theme.schemes.light, theme.schemes.dark]) {
      if (scheme === undefined) continue;
      assert.deepEqual(Object.keys(scheme.color).sort(), [...COLOR_TOKENS].sort(), `${theme.id}: colour tokens`);
      assert.deepEqual(Object.keys(scheme.elevation).sort(), [...ELEVATION_TOKENS].sort(), `${theme.id}: shadows`);
      for (const key of Object.keys(scheme.more ?? {}))
        assert.ok((COLOR_TOKENS as readonly string[]).includes(key), `${theme.id}: more.${key}`);
      for (const [token, value] of Object.entries(scheme.color)) {
        assert.doesNotThrow(() => toLinearRgb(value), `${theme.id} ${token}: ${value}`);
      }
    }
    assert.deepEqual(Object.keys(theme.type.scale).sort(), [...TEXT_SIZES].sort());
    assert.deepEqual(Object.keys(theme.shape.radius).sort(), [...RADII].sort());
    // Home's layout: tests/home-layout.test.ts checks each theme's against the widgets
    const widgetIds = theme.dashboard.widgets.map((w) => w.id);
    assert.equal(new Set(widgetIds).size, widgetIds.length, `${theme.id}: a widget placed twice`);
  }
});

test('themes: the type scale never goes under 12 px and grows step by step', () => {
  for (const theme of themes) {
    const px = TEXT_SIZES.map((s) => Number.parseFloat(theme.type.scale[s].size) * 16);
    assert.ok((px[0] ?? 0) >= 12, `${theme.id}: smallest text ${px[0]} px`);
    for (let i = 1; i < px.length; i++) assert.ok((px[i] ?? 0) > (px[i - 1] ?? 0), `${theme.id}: ${TEXT_SIZES[i]}`);
  }
});

test('themes: text reaches 4.5:1 (7:1 where the theme asks for AAA) and controls and chart marks 3:1 on their surfaces', () => {
  const failures: string[] = [];
  for (const c of cases) {
    for (const [pairs, min] of [
      [TEXT_PAIRS, textMinimum(c.theme)],
      [MARK_PAIRS, 3],
    ] as const) {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(c.color[fg], c.color[bg]);
        if (ratio < min) failures.push(`${c.label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1 (needs ${min})`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('themes: only overlays are translucent', () => {
  for (const c of cases) {
    for (const t of COLOR_TOKENS) {
      if (t === 'scrim') continue;
      assert.equal(hasAlpha(c.color[t]), false, `${c.label}: ${t} must be opaque so its contrast is known`);
    }
  }
});

test('themes: chart series stay apart for typical vision and the three colour-vision deficiencies', () => {
  const visions: Vision[] = ['typical', 'protanopia', 'deuteranopia', 'tritanopia'];
  const failures: string[] = [];
  for (const c of cases) {
    // download and upload (1 and 2) are drawn together everywhere: they get the widest margin
    for (const v of visions) {
      const d12 = distance(c.color['chart-1'], c.color['chart-2'], v);
      if (d12 < 0.12) failures.push(`${c.label}: chart-1/chart-2 under ${v}: ${d12.toFixed(3)}`);
      for (let i = 1; i <= 6; i++) {
        for (let j = i + 1; j <= 6; j++) {
          const d = distance(c.color[`chart-${i}` as ColorToken], c.color[`chart-${j}` as ColorToken], v);
          if (d < 0.06) failures.push(`${c.label}: chart-${i}/chart-${j} under ${v}: ${d.toFixed(3)}`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('themes: the "how much" ramp runs one way, step by step', () => {
  for (const c of cases) {
    const lum = ([1, 2, 3, 4, 5] as const).map((n) => luminance(toLinearRgb(c.color[`ramp-${n}`])));
    const rising = (lum[4] ?? 0) > (lum[0] ?? 0);
    for (let i = 1; i < lum.length; i++) {
      const step = (lum[i] ?? 0) - (lum[i - 1] ?? 0);
      assert.ok(rising ? step > 0 : step < 0, `${c.label}: ramp-${i + 1} is out of order`);
    }
    // the strongest step is the most visible on a panel
    assert.ok(
      contrast(c.color['ramp-5'], c.color.card) > contrast(c.color['ramp-1'], c.color.card),
      `${c.label}: ramp-5 should stand out most`,
    );
  }
});

test('themes: the generated CSS scopes each theme and scheme, with the reduced-motion and more-contrast cases', () => {
  const css = themeCss(themes);
  const first = themes[0];
  assert.ok(first !== undefined);
  assert.match(css, new RegExp(`:root,\\n\\[data-theme='${first.id}'\\] \\{`));
  for (const t of themes) {
    assert.ok(css.includes(`[data-theme='${t.id}'][data-darkmode='true']`), t.id);
  }
  for (const token of COLOR_TOKENS) assert.ok(css.includes(`  --${token}: `), token);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--mf-duration-base: 0ms;/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /--mf-space: /);
  assert.match(css, /color-scheme: dark;/);
});

test('themes: each scheme exports as W3C design tokens', () => {
  for (const theme of themes) {
    for (const scheme of ['light', 'dark'] as const) {
      const file = toDtcg(theme, scheme);
      const colors = file['color'];
      assert.ok(typeof colors === 'object');
      assert.deepEqual(Object.keys(colors).sort(), [...COLOR_TOKENS].sort());
      for (const [name, token] of Object.entries(colors)) {
        assert.equal(token.$type, 'color', name);
        const value = token.$value as { colorSpace: string; components: number[] };
        assert.ok(['oklch', 'srgb'].includes(value.colorSpace), name);
        assert.equal(value.components.length, 3, name);
      }
      assert.ok(JSON.stringify(file).length > 0);
    }
  }
});

test('themes: presentation, chart dashes and tools are complete and valid', () => {
  for (const theme of themes) {
    assert.deepEqual(
      Object.keys(theme.presentation).sort(),
      ['decorativeIcons', 'explanations', 'linkUnderline', 'navCurrent', 'stateMarks'],
      theme.id,
    );
    for (const n of CHART_SERIES)
      assert.match(theme.chart.dash[n], /^(none|\d+(\.\d+)?( \d+(\.\d+)?)+)$/, `${theme.id} chart-${n}`);
    assert.ok(['full', 'compact'].includes(theme.layout.tools), theme.id);
  }
});

test('themes: the generated CSS writes the chart dashes and the link underline', () => {
  for (const theme of themes) {
    const css = themeCss([theme]);
    for (const n of CHART_SERIES)
      assert.ok(css.includes(`--mf-chart-${n}-dash: ${theme.chart.dash[n]};`), `${theme.id} chart-${n}`);
    const underline = theme.presentation.linkUnderline === 'always' ? 'underline' : 'none';
    assert.ok(css.includes(`--mf-link-underline: ${underline};`), theme.id);
  }
});

test('themes: the existing themes keep their look', () => {
  for (const id of ['honey-milk', 'plain-milk', 'moss']) {
    const theme = themes.find((t) => t.id === id);
    assert.ok(theme !== undefined, id);
    assert.deepEqual(theme.presentation, standardPresentation, id);
    assert.deepEqual(theme.chart, solidCharts, id);
    assert.equal(theme.layout.tools, 'full', id);
    assert.equal(theme.contrast, undefined, id);
  }
});

test('themes: Minimamilk is black and white with one red', () => {
  const mm = themes.find((t) => t.id === 'minimamilk');
  assert.ok(mm !== undefined, 'Minimamilk is a built-in theme');
  const s = schemesOf(mm);
  for (const name of ['light', 'dark'] as const) {
    const colors = { ...s[name].color, ...s[name].more };
    for (const [token, value] of Object.entries(colors)) {
      if (token.startsWith('destructive') || token === 'scrim') continue;
      const [r, g, b] = toLinearRgb(value);
      assert.ok(Math.abs(r - g) < 0.002 && Math.abs(g - b) < 0.002, `${name} ${token} is a grey: ${value}`);
    }
    const [r, g, b] = toLinearRgb(s[name].color.destructive);
    assert.ok(r - Math.max(g, b) > 0.1, `${name} destructive is red: ${s[name].color.destructive}`);
  }
  assert.equal(mm.contrast, 'AAA');
});
