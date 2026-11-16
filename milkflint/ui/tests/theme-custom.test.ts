import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastFailures } from '@/theme/checks';
import { contrast, mix, shiftLightness, toHex } from '@/theme/color';
import { COLOR_TOKENS } from '@/theme/contract';
import { schemesOf, themeCss } from '@/theme/css';
import {
  colorsOf,
  EDITABLE,
  MAIN_COLORS,
  MAX_CUSTOM,
  newCustomId,
  parseSettings,
  pickMain,
  pickOne,
  resolveCustom,
  STATUS_COLORS,
  TOKEN_GROUPS,
  TOKEN_LABELS,
} from '@/theme/custom';
import { DEFAULT_THEME_ID, themes } from '@/theme/themes';

const honey = themes.find((t) => t.id === 'honey-milk');
const plain = themes.find((t) => t.id === 'plain-milk');
assert.ok(honey !== undefined && plain !== undefined);

test('built-in themes: Honey milk is the default, Plain milk beside it', () => {
  assert.equal(DEFAULT_THEME_ID, 'honey-milk');
  assert.equal(honey.name, 'Honey milk');
  assert.equal(plain.name, 'Plain milk');
  assert.equal(themes[0]?.id, 'honey-milk', 'the first answers for :root');
});

test('colour maths: hex round trips, mixing and lightness move the way they say', () => {
  assert.equal(toHex('#b5410f'), '#b5410f');
  assert.equal(toHex('oklch(100% 0 0)'), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  const lighter = shiftLightness('#b5410f', 0.1);
  assert.ok(contrast(lighter, '#ffffff') < contrast('#b5410f', '#ffffff'));
});

test('settings from the router: odd entries are dropped, nothing but #rrggbb reaches the CSS', () => {
  const s = parseSettings({
    theme: 'plain-milk',
    custom: [
      { id: 'custom-sea', name: ' Sea ', base: 'plain-milk', colors: { light: { primary: '#0A5F8E', card: 'red;}' }, dark: {} } },
      { id: 'custom-sea', name: 'Twice', base: 'plain-milk', colors: {} },
      { id: 'evil', name: 'No prefix', base: 'plain-milk', colors: {} },
      { id: 'custom-x', name: '', base: 'plain-milk', colors: {} },
      { id: 'custom-y', name: 'Bad base', base: 'Plain Milk!', colors: {} },
      { id: 'custom-z', name: 'Scrim', base: 'honey-milk', colors: { light: { scrim: '#000000', 'not-a-token': '#ffffff' } } },
    ],
  });
  assert.equal(s.theme, 'plain-milk');
  assert.deepEqual(
    s.custom.map((c) => [c.id, c.name]),
    [
      ['custom-sea', 'Sea'],
      ['custom-z', 'Scrim'],
    ],
  );
  assert.deepEqual(s.custom[0]?.colors.light, { primary: '#0a5f8e' });
  assert.deepEqual(s.custom[1]?.colors.light, {}, 'the scrim and unknown roles are not editable');
  assert.deepEqual(parseSettings(null), { theme: null, custom: [] });
  assert.deepEqual(parseSettings({ theme: '../etc' }).theme, null);
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `custom-t${String(i)}`,
    name: `T${String(i)}`,
    base: 'honey-milk',
    colors: {},
  }));
  assert.equal(parseSettings({ custom: many }).custom.length, MAX_CUSTOM);
});

test('new ids come from the name and never clash', () => {
  assert.equal(newCustomId('Sea Breeze!', []), 'custom-sea-breeze');
  assert.equal(newCustomId('Sea Breeze', ['custom-sea-breeze']), 'custom-sea-breeze-2');
  assert.equal(newCustomId('Sea Breeze', ['custom-sea-breeze', 'custom-sea-breeze-2']), 'custom-sea-breeze-3');
  assert.equal(newCustomId('✨', []), 'custom-theme');
});

test('a custom theme is its base with its colours changed, and the rest of the base kept', () => {
  const t = resolveCustom(
    { id: 'custom-sea', name: 'Sea', base: 'honey-milk', colors: { light: { primary: '#0a5f8e', border: '#999999' }, dark: {} } },
    themes,
  );
  const { light, dark } = schemesOf(t);
  assert.equal(light.color.primary, '#0a5f8e');
  assert.equal(light.color.card, schemesOf(honey).light.color.card);
  assert.deepEqual(dark.color, schemesOf(honey).dark.color);
  assert.equal(t.layout, honey.layout);
  assert.equal(t.dashboard, honey.dashboard);
  assert.equal(light.more?.border, undefined, 'the base’s raised-contrast border would undo the change');
  assert.ok(light.more?.input !== undefined, 'raised contrast stays for colours left alone');
  // a base that's gone: the first built-in
  assert.equal(
    resolveCustom({ id: 'custom-a', name: 'A', base: 'gone', colors: { light: {}, dark: {} } }, themes).type,
    honey.type,
  );
});

test('custom CSS: only the custom themes, no :root, every colour', () => {
  const t = resolveCustom(
    { id: 'custom-sea', name: 'Sea', base: 'plain-milk', colors: { light: { primary: '#0a5f8e' }, dark: {} } },
    themes,
  );
  const css = themeCss([t], { root: false });
  assert.ok(!css.includes(':root'));
  assert.ok(css.includes("[data-theme='custom-sea'] {"));
  assert.ok(css.includes('--primary: #0a5f8e;'));
  assert.ok(!css.includes('prefers-reduced-motion'));
});

test('picking the accent brings its hover, tints, focus rings and ramp; a pick back to the base is no change', () => {
  const main = MAIN_COLORS.find((m) => m.token === 'primary');
  assert.ok(main !== undefined);
  const changes = pickMain(main, '#0a5f8e', 'light', honey, {});
  for (const token of ['primary', 'primary-hover', 'primary-subtle', 'ring', 'sidebar-ring', 'selection', 'ramp-5'] as const)
    assert.ok(changes[token] !== undefined, token);
  const colors = colorsOf(honey, 'light', changes);
  assert.ok(contrast(colors['primary-subtle-foreground'], colors['primary-subtle']) >= 4.5);
  const back = pickOne('primary', toHex(schemesOf(honey).light.color.primary), 'light', honey, { primary: '#0a5f8e' });
  assert.deepEqual(back, {});
});

test('the editor covers every colour but the scrim, each with a name, once', () => {
  const listed = TOKEN_GROUPS.flatMap((g) => g.tokens);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), [...EDITABLE].sort());
  for (const token of COLOR_TOKENS) assert.ok(TOKEN_LABELS[token].length > 0);
  for (const m of [...MAIN_COLORS, ...STATUS_COLORS]) assert.ok(EDITABLE.includes(m.token));
});

test('the contrast report: none for the built-in themes, and a failing pick named', () => {
  for (const t of [honey, plain]) {
    const { light, dark } = schemesOf(t);
    assert.deepEqual(contrastFailures(light.color), [], `${t.id} light`);
    assert.deepEqual(contrastFailures(dark.color), [], `${t.id} dark`);
  }
  const pale = colorsOf(honey, 'light', { 'muted-foreground': '#bbbbbb' });
  assert.ok(contrastFailures(pale).some((f) => f.fg === 'muted-foreground' && f.bg === 'card' && f.min === 4.5));
});

test('a custom theme from Minimamilk keeps its presentation, dashes, bar and Home', () => {
  const mm = themes.find((t) => t.id === 'minimamilk');
  assert.ok(mm !== undefined);
  const t = resolveCustom({ id: 'custom-x', name: 'X', base: 'minimamilk', colors: { light: {}, dark: {} } }, themes);
  assert.deepEqual(t.presentation, mm.presentation);
  assert.deepEqual(t.chart, mm.chart);
  assert.deepEqual(t.layout, mm.layout);
  assert.deepEqual(t.dashboard, mm.dashboard);
  assert.equal(t.contrast, mm.contrast);
});
