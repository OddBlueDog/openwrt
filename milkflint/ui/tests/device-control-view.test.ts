// Device control as the pages show it: the Firewall page's reading of its
// sections (whose they are, what they do in words, which were changed by
// hand), the cards (people, and devices only an older rule covers), and a
// week of time off as each day's spans, as fw4 runs the rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  devctlRows,
  deviceRules,
  NO_OVERRIDES,
  personChanges,
  type PersonForm,
  PRESETS,
  type Window,
} from '../src/features/device-control/model.ts';
import { blockedByOlder, entries, formSpans, spansText, weekSpans } from '../src/features/device-control/view.ts';
import { managerOf, parseFirewall } from '../src/features/firewall/model.ts';
import { firewallSummary } from '../src/features/firewall/summary.ts';
import type { Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const zones: Section[] = [
  section('zone', 'lan', { name: 'lan', network: ['lan'] }),
  section('zone', 'wan', { name: 'wan', network: ['wan', 'wan6'], masq: '1' }),
];
const SAM = 'devctl_s4m0';
const IPAD = 'aa:00:00:00:00:01';
const TV = 'aa:00:00:00:00:06';

function preset(id: string): Window {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no preset ${id}`);
  return p.window;
}

const form: PersonForm = {
  name: 'Sam',
  devices: [IPAD],
  windows: [preset('school-nights')],
  always: false,
  safeSearch: false,
  guest: false,
};

/** Sam set up as the page saves him, beside an older Block a device rule for the TV. */
function household(): { firewall: Section[]; milkflint: Section[] } {
  const old = section('rule', 'cfg0a', { name: 'Block TV', src: '*', dest: 'wan', src_mac: TV, proto: 'all', target: 'REJECT' });
  const before = { firewall: [...zones, old], milkflint: [] as Section[] };
  const changes = personChanges(SAM, form, {
    cfg: parseFirewall(before.firewall),
    firewall: before.firewall,
    milkflint: before.milkflint,
    deviceName: () => undefined,
  });
  const after = applied(before, changes);
  return { firewall: after['firewall'] ?? [], milkflint: after['milkflint'] ?? [] };
}

test('the Firewall page knows Device control’s sections: whose they are and what they do, in words', () => {
  const h = household();
  const cfg = parseFirewall(h.firewall, h.milkflint);
  const rows = devctlRows(cfg, h.firewall, h.milkflint, () => undefined);
  assert.deepEqual(rows.get(`${SAM}_w1`), {
    who: 'Sam',
    text: 'Sam: off 21:00–07:00 on school nights',
    byHand: false,
    href: `#/device-control/${SAM}`,
  });
  // the morning half reads as the same window
  assert.equal(rows.get(`${SAM}_w1_am`)?.text, 'Sam: off 21:00–07:00 on school nights');
  assert.equal(rows.get('devctl_pause')?.who, undefined);
  assert.equal(rows.get('devctl_pause')?.href, '#/device-control');
  // an older rule isn't Device control's
  assert.equal(rows.get('cfg0a'), undefined);
  assert.deepEqual(managerOf(`${SAM}_w1`), { page: 'device-control', title: 'Device control' });
  assert.deepEqual(managerOf('devctl_extra'), { page: 'device-control', title: 'Device control' });
  assert.equal(managerOf('cfg0a'), undefined);
  // a rule given a port by hand: still Device control's section, but left alone and edited on the Firewall page
  const port: Record<string, string> = { dest_port: '443' };
  const edited = h.firewall.map((s): Section => (s['.name'] === `${SAM}_w1` ? { ...s, ...port } : s));
  const row = devctlRows(parseFirewall(edited, h.milkflint), edited, h.milkflint, () => undefined).get(`${SAM}_w1`);
  assert.equal(row?.byHand, true);
  assert.match(row.text, /Changed by hand/);
});

test('the Firewall page’s answer counts the devices any rule keeps off the internet, Device control’s too', () => {
  const h = household();
  assert.equal(firewallSummary(parseFirewall(h.firewall, h.milkflint), 0).rules.blocks, 2);
  assert.ok(firewallSummary(parseFirewall(h.firewall, h.milkflint), 0).rules.page >= 3);
});

test('cards: one per person, and one for a device only an older rule covers', () => {
  const h = household();
  const cfg = parseFirewall(h.firewall, h.milkflint);
  const people = [{ id: SAM, name: 'Sam', devices: [IPAD], safeSearch: false, guest: false }];
  const names = new Map([[TV, 'Living room TV']]);
  const list = entries(cfg, h.firewall, people, (m) => names.get(m));
  assert.deepEqual(
    list.map((e) => [e.key, e.title, e.macs, e.older.map((r) => r.section)]),
    [
      [SAM, 'Sam', [IPAD], []],
      ['old:cfg0a', 'Living room TV', [TV], ['cfg0a']],
    ],
  );
  // the older rule for one of Sam's devices goes on Sam's card
  const withOld = [
    ...h.firewall,
    section('rule', 'cfg0b', { src: '*', dest: 'wan', src_mac: IPAD, proto: 'all', target: 'DROP' }),
  ];
  const list2 = entries(parseFirewall(withOld, h.milkflint), withOld, people, () => undefined);
  assert.deepEqual(
    list2[0]?.older.map((r) => r.section),
    ['cfg0b'],
  );
  // extra time can't lift it: the card says so
  const rules = deviceRules(parseFirewall(withOld, h.milkflint));
  assert.equal(blockedByOlder(IPAD, rules, NO_OVERRIDES, { now: 1_794_787_200 + 12 * 3600, offset: 0 }), true);
  assert.equal(
    blockedByOlder(TV, deviceRules(cfg), { paused: new Map([[TV, null]]), extra: new Map() }, { now: 1_794_787_200, offset: 0 }),
    false,
  );
});

test('the week: each day’s time off, Monday first, from the rules as fw4 runs them', () => {
  const h = household();
  const rules = deviceRules(parseFirewall(h.firewall, h.milkflint));
  const week = weekSpans(IPAD, rules);
  assert.deepEqual(week[0], [
    { from: 0, to: 7 * 3600 + 1 },
    { from: 21 * 3600, to: 86400 },
  ]);
  assert.deepEqual(week[4], [{ from: 0, to: 7 * 3600 + 1 }]); // Friday: the morning only
  assert.deepEqual(week[5], []); // Saturday
  assert.equal(spansText(week[0]), 'off until 07:00 and from 21:00');
  assert.equal(spansText(week[5]), 'on all day');
  // the TV's older rule: off all day, every day
  assert.equal(spansText(weekSpans(TV, rules)[2] ?? []), 'off all day');
  // an older overnight rule with days covers both ends of each day ticked
  const old = deviceRules(
    parseFirewall([
      ...zones,
      section('rule', 'r', {
        src: '*',
        dest: 'wan',
        src_mac: TV,
        proto: 'all',
        target: 'REJECT',
        start_time: '22:00',
        stop_time: '07:00',
        weekdays: 'Sat',
      }),
    ]),
  );
  assert.equal(spansText(weekSpans(TV, old)[5] ?? []), 'off until 07:00 and from 22:00');
  assert.equal(spansText(weekSpans(TV, old)[6] ?? []), 'on all day');
  // a form's times before they're saved: the same week
  assert.deepEqual(formSpans([preset('school-nights')], false), week);
  assert.equal(spansText(formSpans([], true)[3] ?? []), 'off all day');
});
