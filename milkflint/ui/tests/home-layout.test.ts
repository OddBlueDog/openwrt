// Home's layout (src/features/dashboard/layout.ts) and the widget registry
// (widgets.tsx): the one parser every layout comes in through, against
// garbage; the edit operations; where the grid puts widgets at four, two and
// one columns; every theme's default; and every widget's entry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWidget,
  type Catalog,
  covering,
  dropIndex,
  type Entry,
  entries,
  gaps,
  GRID_CLASS,
  type Layout,
  MAX_WIDGETS,
  moveWidget,
  nearestSize,
  parseLayout,
  place,
  removeWidget,
  resizeWidget,
  sameLayout,
  type Size,
  sizeClass,
  sizeLabel,
} from '@/features/dashboard/layout';
import { definition, GROUPS, parseHome, WIDGET_IDS, widgets } from '@/features/dashboard/widgets';
import { themes } from '@/theme/themes';

const s = (w: Size['w'], h: Size['h']): Size => ({ w, h });

// a small catalogue of made-up widgets, so these tests don't change with the real ones
const catalog = {
  a: { sizes: [s(1, 1), s(2, 1)] },
  b: { sizes: [s(2, 2), s(4, 2), s(1, 1)] },
  c: { sizes: [s(4, 1)] },
} satisfies Catalog<'a' | 'b' | 'c'>;
// what a layout says, without the keys an edit keeps (they're tested on their own)
const parse = (raw: unknown): Entry[] => entries(parseLayout(raw, catalog));

test('the parser: anything but a list is an empty Home, and an entry that isn’t a widget is left out', () => {
  for (const raw of [undefined, null, 0, 42, 'a', true, {}, { widgets: [] }, () => 1, new Map()])
    assert.deepEqual(parse(raw), []);
  assert.deepEqual(parse([null, 1, 'a', [], {}, { id: 5 }, { id: ['a'] }, { size: s(1, 1) }, { id: 'A' }, { id: ' a' }]), []);
  assert.deepEqual(parse([{ id: 'a', size: s(2, 1) }]), [{ id: 'a', size: s(2, 1) }]);
});

test('the parser: unknown ids are dropped, a widget may come more than once, and never more than Home holds', () => {
  assert.deepEqual(
    parse([
      { id: 'speed-test', size: s(1, 1) },
      { id: 'b', size: s(1, 1) },
      { id: 'a', size: s(1, 1) },
      { id: 'b', size: s(4, 2) },
    ]),
    [
      { id: 'b', size: s(1, 1) },
      { id: 'a', size: s(1, 1) },
      { id: 'b', size: s(4, 2) },
    ],
  );
  const huge = Array.from({ length: 100_000 }, (_, i) => ({ id: ['a', 'b', 'c', 'x'][i % 4], size: s(1, 1) }));
  const out = parseLayout(huge, catalog);
  assert.equal(out.length, MAX_WIDGETS);
  assert.deepEqual(
    out.slice(0, 4).map((w) => w.id),
    ['a', 'b', 'c', 'a'],
  );
  // each one a key of its own, so two of the same widget are told apart while editing
  assert.equal(new Set(out.map((w) => w.key)).size, out.length);
});

test('the parser: a size a widget doesn’t offer moves to the nearest it does; a missing or broken one to its default', () => {
  // b offers 2×2, 4×2, 1×1
  assert.deepEqual(parse([{ id: 'b', size: s(3, 2) }])[0]?.size, s(2, 2), 'a tie goes to the earlier one');
  assert.deepEqual(parse([{ id: 'b', size: s(4, 1) }])[0]?.size, s(4, 2));
  assert.deepEqual(parse([{ id: 'b', size: { w: 1, h: 2 } }])[0]?.size, s(2, 2), 'as near 1×1: the earlier');
  assert.deepEqual(parse([{ id: 'b', size: { w: 99, h: -4 } }])[0]?.size, s(4, 2));
  assert.deepEqual(parse([{ id: 'a', size: { w: 1.6, h: 1 } }])[0]?.size, s(2, 1));
  for (const size of [undefined, null, 'big', s(1, 1).w, { w: '2', h: 1 }, { w: Number.NaN, h: 1 }, { w: Infinity, h: 1 }, []])
    assert.deepEqual(parse([{ id: 'b', size }])[0]?.size, s(2, 2), JSON.stringify(size));
  assert.deepEqual(nearestSize({ w: 4, h: 1 }, [s(1, 1)]), s(1, 1));
  // c offers one size only: whatever is asked
  assert.deepEqual(parse([{ id: 'c', size: s(1, 2) }])[0]?.size, s(4, 1));
});

test('the parser: keys like __proto__ and constructor do nothing', () => {
  const raw: unknown = JSON.parse(
    '[{"id":"__proto__","size":{"w":1,"h":1}},{"id":"constructor"},{"id":"toString"},{"id":"hasOwnProperty"},' +
      '{"id":"a","size":{"__proto__":{"w":2,"h":1}}},{"__proto__":{"id":"b"}},{"id":"c","__proto__":{"size":{"w":1,"h":2}}}]',
  );
  assert.deepEqual(parse(raw), [
    { id: 'a', size: s(1, 1) },
    { id: 'c', size: s(4, 1) },
  ]);
  assert.equal(Object.hasOwn(Object.prototype, 'w'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'id'), false);
  // the real registry too
  assert.deepEqual(parseHome([{ id: '__proto__' }, { id: 'constructor' }, { id: 'valueOf' }]), []);
});

test('moving, resizing, adding and removing, each widget by its key', () => {
  const l: Layout = [
    { key: 'w0', id: 'a', size: s(1, 1) },
    { key: 'w1', id: 'b', size: s(2, 2) },
    { key: 'w2', id: 'c', size: s(4, 1) },
  ];
  const ids = (x: readonly Entry[]): string[] => x.map((w) => w.id);
  assert.deepEqual(ids(moveWidget(l, 0, 2)), ['b', 'c', 'a']);
  assert.deepEqual(ids(moveWidget(l, 2, 0)), ['c', 'a', 'b']);
  assert.deepEqual(ids(moveWidget(l, 1, 1)), ['a', 'b', 'c']);
  assert.deepEqual(ids(moveWidget(l, 0, 99)), ['b', 'c', 'a'], 'kept within the list');
  assert.deepEqual(ids(moveWidget(l, 2, -5)), ['c', 'a', 'b']);
  assert.equal(moveWidget(l, 7, 0), l, 'nothing at that place: unchanged');
  assert.deepEqual(resizeWidget(l, 'w1', s(4, 2))[1], { key: 'w1', id: 'b', size: s(4, 2) });
  assert.deepEqual(resizeWidget(l, 'b', s(4, 2)), l, 'a widget id is no key');
  assert.deepEqual(ids(removeWidget(l, 'w1')), ['a', 'c']);
  assert.deepEqual(ids(removeWidget(l, 'x')), ['a', 'b', 'c']);
  assert.deepEqual(addWidget(removeWidget(l, 'w0'), 'a', s(2, 1)).at(-1), { key: 'w3', id: 'a', size: s(2, 1) }, 'at the end');
  // another of one that's there: a key of its own, and each changed apart from the other
  const two = addWidget(l, 'a', s(2, 1));
  assert.deepEqual(ids(two), ['a', 'b', 'c', 'a']);
  assert.equal(new Set(two.map((w) => w.key)).size, 4);
  assert.deepEqual(entries(resizeWidget(two, 'w3', s(1, 1))), entries([...l, { key: 'w3', id: 'a', size: s(1, 1) }]));
  assert.deepEqual(ids(removeWidget(two, 'w0')), ['b', 'c', 'a']);
  assert.deepEqual(entries(two), [...entries(l), { id: 'a', size: s(2, 1) }], 'saved without the keys');
  // never more than Home holds
  let full: Layout = [];
  for (let i = 0; i < MAX_WIDGETS + 5; i++) full = addWidget(full, 'a', s(1, 1));
  assert.equal(full.length, MAX_WIDGETS);
  assert.equal(addWidget(full, 'b', s(1, 1)), full);
  // none of them changes what it was given
  assert.deepEqual(ids(l), ['a', 'b', 'c']);
  assert.ok(sameLayout(l, [...l]));
  assert.ok(sameLayout(l, entries(l)), 'keys aside');
  assert.ok(!sameLayout(l, resizeWidget(l, 'w0', s(2, 1))));
  assert.ok(!sameLayout(l, moveWidget(l, 0, 1)));
  assert.ok(!sameLayout(l, l.slice(1)));
});

test('the grid at four, two and one columns: a two-row widget with one-row ones beside and below it', () => {
  const l: Entry[] = [
    { id: 'r', size: s(2, 2) },
    { id: 'i', size: s(2, 1) },
    { id: 'w', size: s(1, 1) },
    { id: 'd', size: s(1, 1) },
    { id: 'c', size: s(3, 1) },
    { id: 'm', size: s(1, 2) },
    { id: 'p', size: s(4, 1) },
  ];
  const at = (columns: 1 | 2 | 4): string[] => place(l, columns).map((p) => `${p.id}@${String(p.row)},${String(p.column)}`);
  assert.deepEqual(at(4), ['r@0,0', 'i@0,2', 'w@1,2', 'd@1,3', 'c@2,0', 'm@2,3', 'p@4,0']);
  // the 3-wide one fills the 2 columns there are; the 2-row one beside nothing leaves a gap behind it
  assert.deepEqual(at(2), ['r@0,0', 'i@2,0', 'w@3,0', 'd@3,1', 'c@4,0', 'm@5,0', 'p@7,0']);
  assert.deepEqual(at(1), ['r@0,0', 'i@2,0', 'w@3,0', 'd@4,0', 'c@5,0', 'm@6,0', 'p@8,0']);
  assert.deepEqual(gaps(place(l, 4), 4), [
    { row: 3, column: 0 },
    { row: 3, column: 1 },
    { row: 3, column: 2 },
  ]);
  assert.deepEqual(gaps(place(l, 2), 2), [
    { row: 5, column: 1 },
    { row: 6, column: 1 },
  ]);
  assert.deepEqual(gaps(place(l, 1), 1), []);
});

test('the grid never fills a gap behind: what is seen is the order', () => {
  const l: Entry[] = [
    { id: 'a', size: s(3, 1) },
    { id: 'b', size: s(2, 1) },
    { id: 'c', size: s(1, 1) },
  ];
  // c would fit at row 0, column 3, but it comes after b
  assert.deepEqual(
    place(l, 4).map((p) => [p.id, p.row, p.column]),
    [
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 1, 2],
    ],
  );
});

test('dragging over a gap: the place in the order that lands the widget there', () => {
  // a 2-wide widget leaves the first row's last cell empty: the next one is 2 wide too
  const l: Entry[] = [
    { id: 'i', size: s(1, 1) },
    { id: 's', size: s(2, 1) },
    { id: 't', size: s(2, 1) },
    { id: 'w', size: s(1, 1) },
    { id: 'd', size: s(1, 1) },
  ];
  const gap = { row: 0, column: 3 };
  assert.deepEqual(gaps(place(l, 4), 4)[0], gap);
  assert.equal(covering(place(l, 4), gap), undefined);
  assert.equal(covering(place(l, 4), { row: 0, column: 2 })?.id, 's');
  // the last one, d, goes straight after s; the rest keep their order
  const to = dropIndex(l, 4, gap, 4);
  assert.equal(to, 2);
  const moved = moveWidget(l, 4, to);
  assert.deepEqual(
    moved.map((w) => w.id),
    ['i', 's', 'd', 't', 'w'],
  );
  assert.equal(covering(place(moved, 4), gap)?.id, 'd');
  assert.deepEqual(gaps(place(moved, 4), 4), [{ row: 1, column: 3 }]);
  // so does w, from further up
  assert.equal(dropIndex(l, 3, gap, 4), 2);
  // a 2-wide one has no place in the order that puts it in a 1-wide gap
  assert.equal(dropIndex(l, 2, gap, 4), undefined);
  // at two columns there's no gap there, and a cell beside it is a widget's
  assert.deepEqual(gaps(place(l, 2), 2), [{ row: 0, column: 1 }]);
  assert.equal(dropIndex(l, 3, { row: 0, column: 1 }, 2), 1);
});

test('a size becomes literal grid classes, from a fixed list', () => {
  assert.equal(sizeClass(s(1, 1)), '');
  assert.equal(sizeClass(s(2, 1)), '@2xl/home:col-span-2');
  assert.equal(sizeClass(s(3, 2)), '@2xl/home:col-span-2 @4xl/home:col-span-3 @2xl/home:row-span-2');
  assert.equal(sizeClass(s(4, 1)), '@2xl/home:col-span-2 @4xl/home:col-span-4');
  for (const w of [1, 2, 3, 4] as const) {
    for (const h of [1, 2] as const) {
      for (const c of sizeClass(s(w, h)).split(' ').filter(Boolean))
        assert.match(c, /^(?:@(?:2xl|4xl)\/home:col-span-[234]|@2xl\/home:row-span-2)$/);
    }
  }
  assert.match(GRID_CLASS, /@2xl\/home:grid-cols-2/);
  assert.match(GRID_CLASS, /@4xl\/home:grid-cols-4/);
  assert.doesNotMatch(GRID_CLASS, /dense/);
  // with two or four columns every row is one fixed unit: nothing beside a widget makes it taller
  assert.match(GRID_CLASS, /@2xl\/home:auto-rows-\[--spacing\(\d+\)\]/);
  assert.doesNotMatch(GRID_CLASS, /minmax|auto\)/);
  assert.equal(sizeLabel(s(2, 1)), '2×1');
});

test('every theme’s Home parses as it is, and fills every row at four columns but its last, with or without temperatures', () => {
  for (const theme of themes) {
    const own = theme.dashboard.widgets.map((w) => ({ id: w.id, size: { w: w.size.w, h: w.size.h } }));
    const parsed = entries(parseHome(theme.dashboard.widgets));
    assert.deepEqual(parsed, own, `${theme.id}: a widget Home doesn't know, or a size it doesn't offer`);
    for (const layout of [parsed, parsed.filter((w) => w.id !== 'temperatures')]) {
      const spots = place(layout, 4);
      const last = Math.max(...spots.map((p) => p.row + p.h)) - 1;
      const holes = gaps(spots, 4).filter((g) => g.row !== last);
      assert.deepEqual(holes, [], `${theme.id}: ${layout.map((w) => `${w.id} ${sizeLabel(w.size)}`).join(', ')}`);
    }
  }
});

test('every widget: a title, a line, an icon no other has, a group, and sizes it offers once each', () => {
  const icons = new Set<unknown>();
  const titles = new Set<string>();
  assert.ok(WIDGET_IDS.length > 0);
  assert.equal(WIDGET_IDS.length, Object.keys(widgets).length);
  for (const id of WIDGET_IDS) {
    const def = definition(id);
    assert.match(id, /^[a-z][a-z0-9-]{0,31}$/, 'the router keeps ids of this shape');
    assert.ok(def.title.length > 0 && !titles.has(def.title), `${id}: title`);
    titles.add(def.title);
    assert.ok(def.description.length > 0 && def.description.length <= 120, `${id}: one line`);
    assert.ok(!icons.has(def.icon), `${id}: its icon is another widget's`);
    icons.add(def.icon);
    assert.ok((GROUPS as readonly string[]).includes(def.group), `${id}: group`);
    assert.ok(def.sizes.length >= 1, `${id}: no size`);
    const labels = def.sizes.map(sizeLabel);
    assert.equal(new Set(labels).size, labels.length, `${id}: a size offered twice`);
    for (const z of def.sizes) assert.ok([1, 2, 3, 4].includes(z.w) && [1, 2].includes(z.h), `${id}: ${sizeLabel(z)}`);
  }
  // every group has something in it
  for (const g of GROUPS)
    assert.ok(
      WIDGET_IDS.some((id) => definition(id).group === g),
      g,
    );
});

test('a widget with nothing to show on this router: temperatures without sensors', () => {
  const hidden = definition('temperatures').hidden;
  assert.ok(hidden !== undefined);
  const data = (temperatures: unknown[]): Parameters<typeof hidden>[0] =>
    JSON.parse(JSON.stringify({ d: { stats: { temperatures } }, live: {}, ap: false })) as Parameters<typeof hidden>[0];
  assert.equal(hidden(data([])), true);
  assert.equal(hidden(data([{ name: 'cpu', c: 50 }])), false);
});
