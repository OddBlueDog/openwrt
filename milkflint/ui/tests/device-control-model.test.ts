// Device control's model: a person's times become fw4 rules (an overnight
// window as an evening and a morning, so the days mean what was picked),
// those rules read back the same, anything edited by hand is left alone,
// old Block a device rules are read as fw4 runs them, and what's in force
// now (pause, extra time, the times) and when it next changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Clock,
  daysText,
  devctlPart,
  deviceRules,
  deviceRuleText,
  deviceState,
  extraUntil,
  localParts,
  morningAfter,
  newPersonId,
  nextText,
  oldMeaningDiffers,
  type Overrides,
  parsePeople,
  personChanges,
  type PersonForm,
  personRules,
  PRESETS,
  ruleBlocks,
  ruleName,
  scheduleSummary,
  stateText,
  type Window,
  windowOfRule,
  windowTimes,
} from '../src/features/device-control/model.ts';
import { isDeviceBlock, parseFirewall } from '../src/features/firewall/model.ts';
import type { Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const zones: Section[] = [
  section('zone', 'lan', { name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' }),
  section('zone', 'wan', {
    name: 'wan',
    network: ['wan', 'wan6'],
    input: 'REJECT',
    output: 'ACCEPT',
    forward: 'REJECT',
    masq: '1',
  }),
];
const withGuest: Section[] = [...zones, section('zone', 'guest', { name: 'guest', network: ['guest'] })];

const SAM = 'devctl_s4m0';
const IPAD = 'aa:00:00:00:00:01';
const PHONE = 'aa:00:00:00:00:02';
function preset(id: string): Window {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no preset ${id}`);
  return p.window;
}
const bedtime = preset('bedtime');
const schoolNights = preset('school-nights');
const schoolHours = preset('school-hours');

const form = (over: Partial<PersonForm> = {}): PersonForm => ({
  name: 'Sam',
  devices: [IPAD, PHONE],
  windows: [schoolNights],
  always: false,
  safeSearch: false,
  guest: false,
  ...over,
});

function save(
  before: { firewall: Section[]; milkflint: Section[] },
  id: string,
  f: PersonForm | undefined,
): { firewall: Section[]; milkflint: Section[] } {
  const changes = personChanges(id, f, {
    cfg: parseFirewall(before.firewall),
    firewall: before.firewall,
    milkflint: before.milkflint,
    deviceName: () => undefined,
  });
  const after = applied(before, changes);
  return { firewall: after['firewall'] ?? [], milkflint: after['milkflint'] ?? [] };
}

const rule = (s: { firewall: Section[] }, name: string): Section | undefined => s.firewall.find((x) => x['.name'] === name);

/** The firewall with one section's options changed, as LuCI would leave it. */
const edit = (fw: readonly Section[], name: string, change: Record<string, string | string[]>): Section[] =>
  fw.map((x): Section => (x['.name'] === name ? { ...x, ...change } : x));

// Times on the router's clock in a fixed zone: Monday 2026-11-16 00:00 UTC, GMT
const MON = Date.UTC(2026, 10, 16) / 1000;
const at = (dayFromMon: number, h: number, m = 0, offset = 0): Clock => ({
  now: MON + dayFromMon * 86400 + h * 3600 + m * 60 - offset,
  offset,
});

test('a same-day window is one rule; an overnight one an evening and a morning on the days after', () => {
  assert.deepEqual(windowTimes(schoolHours), [
    { start_time: '08:30:00', stop_time: '15:30:00', weekdays: 'Mon Tue Wed Thu Fri', morning: false },
  ]);
  assert.deepEqual(windowTimes(schoolNights), [
    { start_time: '21:00:00', stop_time: '23:59:59', weekdays: 'Mon Tue Wed Thu Sun', morning: false },
    { start_time: '00:00:00', stop_time: '07:00:00', weekdays: 'Mon Tue Wed Thu Fri', morning: true },
  ]);
  // every day: no weekdays at all
  assert.deepEqual(
    windowTimes(bedtime).map((t) => t.weekdays),
    [undefined, undefined],
  );
  // Saturday night runs into Sunday morning
  assert.equal(windowTimes({ ...bedtime, days: ['Sat'] })[1]?.weekdays, 'Sun');
  // until midnight is the same day
  assert.deepEqual(windowTimes({ start: '20:00', stop: '00:00', days: ['Fri'], label: 'x' }), [
    { start_time: '20:00:00', stop_time: '23:59:59', weekdays: 'Fri', morning: false },
  ]);
});

test('a new person: their section, their rules and the shared sets, pause rule and include', () => {
  const s = save({ firewall: zones, milkflint: [] }, SAM, form());
  const person = s.milkflint.find((x) => x['.name'] === SAM);
  assert.deepEqual(person, { '.type': 'person', '.name': SAM, name: 'Sam', device: [IPAD, PHONE] });
  assert.deepEqual(rule(s, `${SAM}_w1`), {
    '.type': 'rule',
    '.name': `${SAM}_w1`,
    name: 'Sam: School nights',
    src: '*',
    dest: 'wan',
    src_mac: [IPAD, PHONE],
    ipset: '!devctl_extra',
    proto: 'all',
    target: 'REJECT',
    start_time: '21:00:00',
    stop_time: '23:59:59',
    weekdays: 'Mon Tue Wed Thu Sun',
  });
  assert.equal(rule(s, `${SAM}_w1_am`)?.['name'], 'Sam: School nights (morning)');
  assert.equal(rule(s, `${SAM}_w1_am`)?.['weekdays'], 'Mon Tue Wed Thu Fri');
  const paused = s.firewall.find((x) => x['.name'] === 'devctl_paused');
  assert.deepEqual(paused, {
    '.type': 'ipset',
    '.name': 'devctl_paused',
    name: 'devctl_paused',
    family: 'any',
    match: ['src_mac'],
    timeout: '0',
  });
  assert.equal(rule(s, 'devctl_pause')?.['ipset'], 'devctl_paused');
  assert.equal(s.firewall.find((x) => x['.name'] === 'devctl_restore')?.['type'], 'script');
  // the Firewall page counts them as device blocks once they're for one device
  const cfg = parseFirewall(s.firewall);
  assert.equal(cfg.rules.filter((r) => isDeviceBlock(r, cfg)).length, 0);
});

test('saved rules read back as the same windows, all of them Device control’s own; saving again changes nothing', () => {
  const s = save({ firewall: zones, milkflint: [] }, SAM, form({ windows: [schoolNights, schoolHours], always: true }));
  const [p] = parsePeople(s.milkflint);
  assert.ok(p !== undefined);
  const r = personRules(parseFirewall(s.firewall), s.firewall, p);
  assert.deepEqual(r.windows, [schoolNights, schoolHours]);
  assert.equal(r.always, true);
  assert.deepEqual(r.byHand, []);
  assert.deepEqual(r.owned.sort(), [`${SAM}_always`, `${SAM}_w1`, `${SAM}_w1_am`, `${SAM}_w2`].sort());
  const changes = personChanges(SAM, form({ windows: [schoolNights, schoolHours], always: true }), {
    cfg: parseFirewall(s.firewall),
    firewall: s.firewall,
    milkflint: s.milkflint,
    deviceName: () => undefined,
  });
  assert.deepEqual(changes, []);
});

test('a device added: every rule of theirs gets it; a window taken out goes with both its halves', () => {
  const s1 = save({ firewall: zones, milkflint: [] }, SAM, form({ windows: [schoolNights, schoolHours] }));
  const s2 = save(s1, SAM, form({ devices: [IPAD, PHONE, 'aa:00:00:00:00:03'], windows: [schoolHours] }));
  assert.deepEqual(rule(s2, `${SAM}_w1`)?.['src_mac'], [IPAD, PHONE, 'aa:00:00:00:00:03']);
  assert.equal(rule(s2, `${SAM}_w1`)?.['start_time'], '08:30:00');
  assert.equal(rule(s2, `${SAM}_w1_am`), undefined);
  assert.equal(rule(s2, `${SAM}_w2`), undefined);
});

test('a rule edited by hand is shown as it is and never overwritten; new windows skip its number', () => {
  const s1 = save({ firewall: zones, milkflint: [] }, SAM, form({ windows: [schoolHours] }));
  // a port added in LuCI: no longer what Device control writes
  const edited = { ...s1, firewall: edit(s1.firewall, `${SAM}_w1`, { dest_port: '443', proto: 'tcp' }) };
  const [p] = parsePeople(edited.milkflint);
  assert.ok(p !== undefined);
  const r = personRules(parseFirewall(edited.firewall), edited.firewall, p);
  assert.deepEqual(r.windows, []);
  assert.deepEqual(
    r.byHand.map((x) => x['.name']),
    [`${SAM}_w1`],
  );
  const s2 = save(edited, SAM, form({ windows: [bedtime] }));
  assert.equal(rule(s2, `${SAM}_w1`)?.['dest_port'], '443');
  assert.equal(rule(s2, `${SAM}_w1`)?.['start_time'], '08:30:00');
  assert.equal(rule(s2, `${SAM}_w2`)?.['start_time'], '21:00:00');
  // turned off on the Firewall page, or devices changed there: by hand too
  for (const change of [{ enabled: '0' }, { src_mac: [IPAD] }, { weekdays: '!Sat' }, { family: 'ipv4' }]) {
    const fw = edit(s1.firewall, `${SAM}_w1`, change);
    assert.equal(personRules(parseFirewall(fw), fw, p).byHand.length, 1, JSON.stringify(change));
  }
  // its name changed in LuCI isn't a hand edit: names are Device control's to write
  const renamed = edit(s1.firewall, `${SAM}_w1`, { name: 'Homework' });
  assert.equal(personRules(parseFirewall(renamed), renamed, p).byHand.length, 0);
});

test('an overnight window whose halves no longer agree is two rules edited by hand', () => {
  const s1 = save({ firewall: zones, milkflint: [] }, SAM, form());
  const fw = edit(s1.firewall, `${SAM}_w1_am`, { weekdays: 'Mon Tue' });
  const [p] = parsePeople(s1.milkflint);
  assert.ok(p !== undefined);
  const r = personRules(parseFirewall(fw), fw, p);
  assert.deepEqual(r.windows, []);
  assert.deepEqual(r.byHand.map((x) => x['.name']).sort(), [`${SAM}_w1`, `${SAM}_w1_am`]);
});

test('deleting a person takes every rule of theirs; the last one takes the shared sections too', () => {
  const s1 = save({ firewall: zones, milkflint: [] }, SAM, form());
  const s2 = save(s1, 'devctl_al3x', form({ name: 'Alex', devices: ['aa:00:00:00:00:09'] }));
  const s3 = save(s2, SAM, undefined);
  assert.equal(
    s3.milkflint.some((x) => x['.name'] === SAM),
    false,
  );
  assert.equal(
    s3.firewall.some((x) => x['.name'].startsWith(SAM)),
    false,
  );
  assert.ok(rule(s3, 'devctl_pause') !== undefined);
  const s4 = save(s3, 'devctl_al3x', undefined);
  assert.deepEqual(
    s4.firewall.map((x) => x['.name']),
    ['lan', 'wan'],
  );
});

test('Guest Wi-Fi at their times: a rule from each guest network, read back as theirs, gone when turned off', () => {
  const s1 = save({ firewall: withGuest, milkflint: [] }, SAM, form({ guest: true }));
  assert.deepEqual(
    [
      rule(s1, `${SAM}_w1_guest`)?.['src'],
      rule(s1, `${SAM}_w1_guest`)?.['src_mac'],
      rule(s1, `${SAM}_w1_guest_am`)?.['weekdays'],
    ],
    ['guest', undefined, 'Mon Tue Wed Thu Fri'],
  );
  assert.equal(rule(s1, `${SAM}_w1_guest`)?.['name'], 'Sam: School nights, Guest Wi-Fi');
  const [p] = parsePeople(s1.milkflint);
  assert.ok(p?.guest === true);
  const r = personRules(parseFirewall(s1.firewall), s1.firewall, p);
  assert.deepEqual(r.byHand, []);
  assert.equal(r.guestDrift, false);
  assert.equal(r.owned.length, 4);
  const s2 = save(s1, SAM, form({ guest: false }));
  assert.equal(rule(s2, `${SAM}_w1_guest`), undefined);
  assert.equal(rule(s2, `${SAM}_w1_guest_am`), undefined);
});

test('section names: a person’s rules, the shared ones, and nothing else', () => {
  assert.deepEqual(devctlPart('devctl_s4m0_w2_am'), { kind: 'window', person: SAM, n: 2, guest: undefined, morning: true });
  assert.deepEqual(devctlPart('devctl_s4m0_w1_guest2'), { kind: 'window', person: SAM, n: 1, guest: 'guest2', morning: false });
  assert.deepEqual(devctlPart('devctl_s4m0_always'), { kind: 'always', person: SAM });
  assert.deepEqual(devctlPart('devctl_pause'), { kind: 'global' });
  assert.equal(devctlPart('devctl_s4m0'), undefined);
  assert.equal(devctlPart('cfg1234'), undefined);
  assert.equal(devctlPart('devctl_toolong_w1'), undefined);
  const taken = new Set(['devctl_aaaa', 'devctl_aaab_w1']);
  const seq = [0, 0, 0, 0, 0, 0, 0, 1 / 36, 0, 0, 0, 2 / 36];
  let i = 0;
  assert.equal(
    newPersonId(taken, () => seq[i++] ?? 0.5),
    'devctl_aaac',
  );
});

test('a long name is cut short so the rule’s name stays within 50 characters', () => {
  const name = ruleName('Alexandra-Margaret the Third of Hereford', 'School nights (morning)');
  assert.ok(name.length <= 50, name);
  assert.ok(name.endsWith('…: School nights (morning)'));
  assert.equal(ruleName('Sam', 'Bedtime'), 'Sam: Bedtime');
});

// ---- What's in force ----

test('the router’s clock: day and second of the day in its own time zone', () => {
  assert.deepEqual(localParts(MON, 0), { day: 0, sec: 0, midnight: MON });
  // 00:30 on Monday in summer time (UTC+1) is still Sunday 23:30 UTC
  assert.deepEqual(localParts(MON - 1800, 3600), { day: 0, sec: 1800, midnight: MON - 3600 });
  assert.equal(localParts(MON + 6 * 86400 + 3600, 0).day, 6);
});

test('fw4’s own reading of an overnight rule with days: each packet’s day, both ends of it', () => {
  const old = {
    start: 22 * 3600,
    stop: 7 * 3600,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as Window['days'],
    invertDays: false,
  };
  assert.equal(ruleBlocks(old, 4, 2 * 3600), true); // Friday 02:00 (Thursday night)
  assert.equal(ruleBlocks(old, 5, 2 * 3600), false); // Saturday 02:00 (Friday night): not blocked
  assert.equal(ruleBlocks(old, 0, 2 * 3600), true); // Monday 02:00 (Sunday night): blocked
  assert.equal(ruleBlocks(old, 4, 23 * 3600), true); // Friday 23:00
  // the bounds of a range across midnight are outside it, as nftables writes it
  assert.equal(ruleBlocks(old, 1, 22 * 3600), false);
  assert.equal(ruleBlocks(old, 1, 22 * 3600 + 1), true);
  assert.equal(ruleBlocks(old, 1, 7 * 3600), false);
  const sameDay = { start: 8.5 * 3600, stop: 15.5 * 3600, days: undefined, invertDays: false };
  assert.equal(ruleBlocks(sameDay, 2, 15.5 * 3600), true);
  assert.equal(ruleBlocks(sameDay, 2, 15.5 * 3600 + 1), false);
  const notSat = { start: undefined, stop: undefined, days: ['Sat'] as Window['days'], invertDays: true };
  assert.equal(ruleBlocks(notSat, 5, 0), false);
  assert.equal(ruleBlocks(notSat, 6, 0), true);
});

function setUp(f: PersonForm): { rules: ReturnType<typeof deviceRules> } {
  const s = save({ firewall: zones, milkflint: [] }, SAM, f);
  return { rules: deviceRules(parseFirewall(s.firewall)) };
}

const none: Overrides = { paused: new Map(), extra: new Map() };

test('school nights as written now: Thursday night into Friday is off, Saturday night isn’t', () => {
  const { rules } = setUp(form());
  const fri2am = deviceState(IPAD, rules, none, at(4, 2));
  assert.equal(fri2am.blocked, true);
  assert.equal(stateText(fri2am, at(4, 2)), 'Off until 07:00');
  assert.equal(nextText(fri2am, at(4, 2)), 'Back on at 07:00');
  assert.equal(deviceState(IPAD, rules, none, at(6, 2)).blocked, false); // Sunday 02:00
  const sun = deviceState(IPAD, rules, none, at(6, 20));
  assert.equal(sun.reason, 'free');
  assert.equal(nextText(sun, at(6, 20)), 'Off at 21:00');
  // Friday evening: free all weekend, next off Sunday 21:00
  const friEve = deviceState(IPAD, rules, none, at(4, 21, 30));
  assert.equal(friEve.blocked, false);
  assert.equal(nextText(friEve, at(4, 21, 30)), 'Off Sunday 21:00');
});

test('in summer time the windows follow the local clock', () => {
  const { rules } = setUp(form({ windows: [bedtime] }));
  const offset = 3600;
  assert.equal(deviceState(IPAD, rules, none, at(2, 21, 30, offset)).blocked, true);
  assert.equal(deviceState(IPAD, rules, none, at(2, 20, 30, offset)).blocked, false);
  assert.equal(stateText(deviceState(IPAD, rules, none, at(2, 23, 0, offset)), at(2, 23, 0, offset)), 'Off until 07:00');
});

test('pause and extra time: a pause wins, extra time lifts Device control’s rules but not older ones', () => {
  const { rules } = setUp(form({ windows: [bedtime] }));
  const now = at(1, 22);
  const paused: Overrides = { paused: new Map([[IPAD, now.now + 1800]]), extra: new Map([[IPAD, now.now + 3600]]) };
  assert.equal(stateText(deviceState(IPAD, rules, paused, now), now), 'Paused until 22:30');
  const forever: Overrides = { paused: new Map([[IPAD, null]]), extra: new Map() };
  assert.deepEqual(deviceState(IPAD, rules, forever, now), { blocked: true, reason: 'paused', until: null });
  assert.equal(stateText(deviceState(IPAD, rules, forever, now), now), 'Paused until you resume');
  const extra: Overrides = { paused: new Map(), extra: new Map([[IPAD, now.now + 3600]]) };
  const s = deviceState(IPAD, rules, extra, now);
  assert.deepEqual([s.reason, s.blocked], ['extra', false]);
  assert.equal(stateText(s, now), 'Extra time until 23:00');
  // an old Block a device rule for the same device: extra time doesn't lift it
  const old = deviceRules(
    parseFirewall([
      ...zones,
      section('rule', 'cfg01', { name: 'Block iPad', src: '*', dest: 'wan', src_mac: IPAD, proto: 'all', target: 'REJECT' }),
    ]),
  );
  assert.equal(deviceState(IPAD, [...rules, ...old], extra, now).reason, 'always');
  // a pause ends by itself: back to its times
  const later = { ...now, now: now.now + 1900 };
  assert.equal(deviceState(IPAD, rules, paused, later).reason, 'extra');
});

test('extra time: a set length, never past the block’s end; or until the next block', () => {
  const { rules } = setUp(form({ windows: [bedtime] }));
  const now = at(1, 21, 30);
  assert.equal(extraUntil('30m', IPAD, rules, now), now.now + 1800);
  const late = at(2, 6, 45);
  assert.equal(extraUntil('1h', IPAD, rules, late), MON + 2 * 86400 + 7 * 3600 + 1);
  // until the next block: tomorrow 21:00
  assert.equal(extraUntil('next', IPAD, rules, now), MON + 2 * 86400 + 21 * 3600);
  // nothing to give while it isn't off
  assert.equal(extraUntil('30m', IPAD, rules, at(1, 12)), undefined);
});

test('“until tomorrow morning”: when their coming night ends, else 07:00', () => {
  const tue10pm = at(1, 22);
  assert.equal(morningAfter([], tue10pm), MON + 2 * 86400 + 7 * 3600);
  assert.equal(morningAfter([{ ...bedtime, stop: '06:30' }], tue10pm), MON + 2 * 86400 + 6.5 * 3600);
  // the window has to start on the evening before that morning
  assert.equal(morningAfter([{ ...schoolNights, stop: '06:30' }], at(4, 22)), MON + 5 * 86400 + 7 * 3600);
  // in the small hours, this morning
  assert.equal(morningAfter([], at(2, 1)), MON + 2 * 86400 + 7 * 3600);
});

test('old Block a device rules, read as fw4 runs them, and as the window they’d become', () => {
  const cfg = parseFirewall([
    ...zones,
    section('rule', 'cfg01', {
      name: 'Block Switch',
      src: '*',
      dest: 'wan',
      src_mac: 'AA:00:00:00:00:05',
      proto: 'all',
      target: 'REJECT',
      start_time: '22:00:00',
      stop_time: '07:00:00',
      weekdays: 'Mon Tue Wed Thu Fri',
    }),
    section('rule', 'cfg02', {
      name: 'Block TV',
      src: '*',
      dest: 'wan',
      src_mac: 'aa:00:00:00:00:06',
      proto: 'all',
      target: 'DROP',
    }),
    // a port: only part of its traffic, not a device block
    section('rule', 'cfg03', {
      src: 'lan',
      dest: 'wan',
      src_mac: 'aa:00:00:00:00:07',
      proto: 'tcp',
      dest_port: '25',
      target: 'REJECT',
    }),
    section('rule', 'cfg04', {
      src: '*',
      dest: 'wan',
      src_mac: 'aa:00:00:00:00:08',
      proto: 'all',
      target: 'REJECT',
      enabled: '0',
    }),
  ]);
  const rules = deviceRules(cfg);
  assert.deepEqual(
    rules.map((r) => [r.section, r.macs, r.exempt, r.person]),
    [
      ['cfg01', ['aa:00:00:00:00:05'], false, undefined],
      ['cfg02', ['aa:00:00:00:00:06'], false, undefined],
    ],
  );
  const [sw, tv] = rules;
  assert.ok(sw !== undefined && tv !== undefined);
  assert.equal(deviceRuleText(sw), 'Off until 07:00 and from 22:00 on Mon–Fri');
  assert.equal(deviceRuleText(tv), 'Always off');
  assert.equal(oldMeaningDiffers(sw), true);
  assert.deepEqual(windowOfRule(sw), {
    start: '22:00',
    stop: '07:00',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    label: 'Internet off',
  });
  const [first] = cfg.rules;
  assert.ok(first !== undefined);
  assert.equal(isDeviceBlock(first, cfg), true);
});

test('times in words', () => {
  assert.equal(daysText(schoolNights), 'on school nights');
  assert.equal(daysText(schoolHours), 'on weekdays');
  assert.equal(daysText(bedtime), 'every night');
  assert.equal(daysText({ ...schoolHours, days: ['Sat', 'Sun'] }), 'at weekends');
  assert.equal(daysText({ ...bedtime, days: ['Fri', 'Sat'] }), 'on Friday and Saturday nights');
  assert.equal(daysText({ ...schoolHours, days: ['Mon', 'Wed', 'Fri'] }), 'on Mon, Wed and Fri');
  assert.equal(daysText({ ...schoolHours, days: ['Mon', 'Tue', 'Wed', 'Thu'] }), 'on Mon–Thu');
  assert.equal(daysText({ ...bedtime, days: ['Sun'] }), 'on Sunday nights');
  assert.equal(scheduleSummary([schoolNights], false), 'Off 21:00–07:00 on school nights');
  assert.equal(
    scheduleSummary([schoolNights, schoolHours], false),
    'Off 21:00–07:00 on school nights and 08:30–15:30 on weekdays',
  );
  assert.equal(scheduleSummary([], true), 'Always off');
  assert.equal(scheduleSummary([], false), 'No set times');
});
