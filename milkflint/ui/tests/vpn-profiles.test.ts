// VPN profiles' model: named presets of the whole form as milkflint sections, one active.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankForm, type ClientData, type ClientForm, removal, toChanges } from '../src/features/vpn-client/model.ts';
import {
  activateChanges,
  createChanges,
  deleteChanges,
  differs,
  formOf,
  nameError,
  newProfileId,
  nextProfileId,
  copyLiveChanges,
  macsOf,
  type Profile,
  profileSummary,
  profileToSection,
  renameChanges,
  saveAsChanges,
  saveWithProfile,
  sectionToProfile,
  updateChanges,
} from '../src/features/vpn-client/profiles.ts';
import { ipToInt } from '../src/lib/api/network.ts';
import { section } from './uci-fixture.ts';

const KEY = `${'a'.repeat(42)}A=`;
const OTHER = `${'b'.repeat(42)}E=`;
const PSK = `${'c'.repeat(42)}I=`;

const full = (over: Partial<ClientForm> = {}): ClientForm => ({
  enabled: true,
  privateKey: KEY,
  addresses: ['10.64.12.7/32', 'fc00:bbbb::7/128'],
  mtu: '1380',
  publicKey: OTHER,
  presharedKey: PSK,
  endpointHost: 'fr.example.com',
  endpointPort: '51821',
  keepalive: '15',
  who: 'except',
  macs: ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02'],
  guests: ['guest'],
  killSwitch: false,
  useVpnDns: true,
  dns: ['10.64.0.1', 'fc00::1'],
  shaper: true,
  downMbit: '400',
  upMbit: '80',
  direct: ['bbc.co.uk', 'itv.com'],
  ...over,
});

const data = (over: Partial<ClientData> = {}): ClientData => ({
  installed: true,
  exists: false,
  form: blankForm({ sqm: true, wanRates: { down: 500, up: 100 } }),
  peerSection: 'wg_out_server',
  present: { network: [], firewall: [], sqm: [], milkflint: [] },
  wanZone: 'wan',
  lanZone: 'lan',
  guestZones: [{ id: 'guest', label: 'Guest' }],
  devices: [],
  sqm: true,
  wanRates: { down: 500, up: 100 },
  lan: { ip: ipToInt('192.168.1.1') ?? 0, prefix: 24 },
  taken: [],
  profiles: [],
  active: undefined,
  ...over,
});

const formOnly = formOf;
const profile = (id: string, name: string, f: ClientForm = full()): Profile => ({ id, name, form: formOnly(f) });
const stored = (p: Profile): ReturnType<typeof section> => section('vpn_profile', p.id, profileToSection(p.name, p.form));

test('a full form round-trips through its section, every list included', () => {
  const p = profile('vpnp_1', 'France');
  assert.deepEqual(sectionToProfile(stored(p), data()), p);
});

test('a section missing options takes the blank form values; unknown guest networks are dropped', () => {
  const d = data();
  const got = sectionToProfile(section('vpn_profile', 'vpnp_3', { name: 'Bare', guests: ['guest', 'guest2'] }), d);
  assert.deepEqual(got, { id: 'vpnp_3', name: 'Bare', form: { ...formOf(blankForm(d)), guests: ['guest'] } });
  assert.equal(sectionToProfile(section('vpn_profile', 'vpnp_4'), d).name, 'vpnp_4');
});

test('nameError: blank, too long, duplicate in other case, control character, own name on rename', () => {
  const others = [profile('vpnp_1', 'France')];
  assert.notEqual(nameError('  ', others), undefined);
  assert.notEqual(nameError('x'.repeat(33), others), undefined);
  assert.equal(nameError('x'.repeat(32), others), undefined);
  assert.notEqual(nameError('FRANCE', others), undefined);
  assert.notEqual(nameError('a\u0007b', others), undefined);
  assert.equal(nameError('USA', others), undefined);
  assert.equal(nameError('france', others, 'vpnp_1'), undefined);
});

test('nextProfileId fills gaps', () => {
  assert.equal(nextProfileId([]), 'vpnp_1');
  assert.equal(nextProfileId([profile('vpnp_1', 'a'), profile('vpnp_3', 'c')]), 'vpnp_2');
  assert.equal(nextProfileId([profile('vpnp_1', 'a'), profile('vpnp_2', 'b')]), 'vpnp_3');
});

test('create, rename, update and delete touch only the profile section', () => {
  const p = profile('vpnp_1', 'France');
  assert.deepEqual(createChanges(' USA ', formOnly(full()), [p]), [
    { op: 'add', config: 'milkflint', type: 'vpn_profile', name: 'vpnp_2', values: profileToSection('USA', formOnly(full())) },
  ]);
  assert.deepEqual(renameChanges(p, 'Paris'), [{ op: 'set', config: 'milkflint', section: 'vpnp_1', values: { name: 'Paris' } }]);
  assert.deepEqual(renameChanges(p, 'France'), []);
  assert.deepEqual(updateChanges(p, formOnly(full())), []);
  assert.deepEqual(updateChanges(p, formOnly(full({ mtu: '', who: 'all', macs: [] }))), [
    { op: 'set', config: 'milkflint', section: 'vpnp_1', values: { who: 'all' } },
    { op: 'unset', config: 'milkflint', section: 'vpnp_1', options: ['mtu', 'macs'] },
  ]);
  assert.deepEqual(deleteChanges(p), [{ op: 'delete', config: 'milkflint', section: 'vpnp_1' }]);
});

test('activateChanges is the live save of the form, switched on, plus one pointer set', () => {
  const p = profile('vpnp_1', 'France');
  const d = data({
    present: { network: [], firewall: [], sqm: [], milkflint: [section('vpn_profiles', 'vpn_profiles', { active: 'vpnp_2' })] },
  });
  const got = activateChanges(p, d);
  assert.deepEqual(got, [
    ...toChanges({ ...p.form, enabled: true }, d),
    { op: 'set', config: 'milkflint', section: 'vpn_profiles', values: { active: 'vpnp_1' } },
  ]);
  assert.equal(got.filter((c) => c.config === 'milkflint' && 'section' in c && c.section === 'vpn_profiles').length, 1);
  // no pointer section yet: it's added
  assert.deepEqual(activateChanges(p, data()).at(-1), {
    op: 'add',
    config: 'milkflint',
    type: 'vpn_profiles',
    name: 'vpn_profiles',
    values: { active: 'vpnp_1' },
  });
});

test('saveWithProfile adds the active profile’s update; without one it is toChanges', () => {
  const d = data();
  const p = profile('vpnp_1', 'France');
  const f = full({ endpointHost: 'de.example.com', enabled: false });
  assert.deepEqual(saveWithProfile(f, d, undefined), toChanges(f, d));
  assert.deepEqual(saveWithProfile(f, d, p), [
    ...toChanges(f, d),
    { op: 'set', config: 'milkflint', section: 'vpnp_1', values: { endpoint_host: 'de.example.com' } },
  ]);
});

test('removal keeps the profiles and deletes the pointer’s active option', () => {
  const p = profile('vpnp_1', 'France');
  const d = data({
    exists: true,
    present: {
      network: [section('interface', 'wg_out')],
      firewall: [],
      sqm: undefined,
      milkflint: [stored(p), section('vpn_profiles', 'vpn_profiles', { active: 'vpnp_1' }), section('vpn_client', 'vpn_client')],
    },
  });
  const got = removal(d);
  const sectionOf = (c: (typeof got)[number]): string => ('section' in c ? c.section : '');
  assert.ok(!got.some((c) => c.op === 'delete' && sectionOf(c).startsWith('vpnp_')));
  assert.ok(!got.some((c) => c.op === 'delete' && c.section === 'vpn_profiles'));
  assert.ok(got.some((c) => c.op === 'unset' && sectionOf(c) === 'vpn_profiles' && c.options.includes('active')));
  assert.ok(got.some((c) => c.op === 'delete' && sectionOf(c) === 'vpn_client'));
});

test('differs: false for the live form of the same settings, true after one field changes', () => {
  const p = profile('vpnp_1', 'France');
  assert.equal(differs(p, full({ enabled: false }), data()), false);
  assert.equal(
    differs(
      p,
      full({ macs: ['aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:01'], addresses: [' 10.64.12.7/32', 'fc00:bbbb::7/128'] }),
      data(),
    ),
    false,
  );
  assert.equal(differs(p, full({ keepalive: '25' }), data()), true);
  assert.equal(differs(p, full({ dns: ['10.64.0.1'] }), data()), true);
});

test('the sites that go direct: kept with the profile, compared only where the router can run them', () => {
  const p = profile('vpnp_1', 'France');
  assert.deepEqual(stored(p)['direct'], ['bbc.co.uk', 'itv.com']);
  assert.deepEqual(sectionToProfile(section('vpn_profile', 'vpnp_2', { name: 'Old' }), data()).form.direct, []);
  const on = data({ nftset: true });
  assert.equal(differs(p, full({ direct: ['itv.com', 'bbc.co.uk'] }), on), false);
  assert.equal(differs(p, full({ direct: ['bbc.co.uk'] }), on), true);
  // an older image's dnsmasq: the list isn't written, so the live config reads back without it
  assert.equal(differs(p, full({ direct: [] }), data({ nftset: false })), false);
});

test('profileSummary: server, who and kill switch; "Needs a server" only when it has none', () => {
  const d = data();
  assert.equal(
    profileSummary(profile('vpnp_1', 'France'), d),
    'fr.example.com:51821 · Every home device but 2 devices and Guest · Kill switch off',
  );
  assert.equal(profileSummary({ id: 'vpnp_2', name: 'Blank', form: formOf(blankForm(d)) }, d), 'Needs a server');
  // a server, but nobody picked to use it: its summary, and Activate says what to fix
  assert.equal(
    profileSummary(profile('vpnp_3', 'Nobody', full({ who: 'none', guests: [] })), d),
    'fr.example.com:51821 · No one · Kill switch off',
  );
});

test('saveAsChanges: a new profile holding the form, made active', () => {
  const taken = profile('vpnp_1', 'USA');
  const d = data({ profiles: [taken] });
  const f = full({ endpointHost: 'de.example.com' });
  assert.deepEqual(saveAsChanges(' Germany ', f, d), [
    ...createChanges('Germany', formOf(f), [taken]),
    { op: 'add', config: 'milkflint', type: 'vpn_profiles', name: 'vpn_profiles', values: { active: 'vpnp_2' } },
  ]);
});

// what loadClient builds from the config a save wrote: a list the "who" doesn't use is empty, a queue that
// wasn't written reads back off with the blank rates
const readback = (f: ClientForm, d: ClientData): ClientForm => {
  const blank = blankForm(d);
  const queue = f.shaper && d.sqm;
  return {
    ...f,
    macs: f.who === 'only' || f.who === 'except' ? f.macs : [],
    shaper: queue,
    downMbit: queue ? String(Number(f.downMbit)) : blank.downMbit,
    upMbit: queue ? String(Number(f.upMbit)) : blank.upMbit,
  };
};

test('differs: false right after the page’s own save, whatever the form held that the save doesn’t keep', () => {
  const d = data();
  const forms = [
    full({ who: 'all', macs: ['aa:bb:cc:dd:ee:01'] }),
    full({ who: 'none', macs: ['aa:bb:cc:dd:ee:01'] }),
    full({ shaper: false, downMbit: '12abc', upMbit: '' }),
    full({ shaper: true, downMbit: '100.0', upMbit: '0080' }),
  ];
  for (const f of forms) {
    // the profile holds the form as saved; the page reads back the live config
    assert.equal(differs(profile('vpnp_1', 'France', f), readback(f, d), d), false);
    assert.equal(differs(profile('vpnp_1', 'France', readback(f, d)), f, d), false);
  }
  // without Smart Queue installed the queue can't be there
  const bare = data({ sqm: false, wanRates: undefined });
  assert.equal(differs(profile('vpnp_1', 'France', full({ shaper: true })), readback(full({ shaper: true }), bare), bare), false);
  // numbers compare as numbers, and a real difference still shows
  assert.equal(differs(profile('vpnp_1', 'France'), full({ downMbit: '400.0' }), d), false);
  assert.equal(differs(profile('vpnp_1', 'France'), full({ downMbit: '300' }), d), true);
  assert.equal(differs(profile('vpnp_1', 'France'), full({ macs: ['aa:bb:cc:dd:ee:01'] }), d), true);
  assert.deepEqual(macsOf(full({ who: 'all' })), []);
});

test('nextProfileId never reuses the id a stale pointer names', () => {
  assert.equal(nextProfileId([], 'vpnp_1'), 'vpnp_2');
  assert.equal(nextProfileId([profile('vpnp_2', 'b')], 'vpnp_1'), 'vpnp_3');
  const d = data({
    present: { network: [], firewall: [], sqm: [], milkflint: [section('vpn_profiles', 'vpn_profiles', { active: 'vpnp_1' })] },
  });
  assert.equal(newProfileId(d), 'vpnp_2');
  assert.equal(
    saveAsChanges('A', full(), d)[0]?.op === 'add' && (saveAsChanges('A', full(), d)[0] as { name: string }).name,
    'vpnp_2',
  );
});

test('copyLiveChanges: the copy becomes active when no profile is, and only then', () => {
  const none = copyLiveChanges('USA', formOf(full()), data({ exists: true }));
  assert.deepEqual(none.at(-1), {
    op: 'add',
    config: 'milkflint',
    type: 'vpn_profiles',
    name: 'vpn_profiles',
    values: { active: 'vpnp_1' },
  });
  const p = profile('vpnp_1', 'France');
  const some = copyLiveChanges('USA', formOf(full()), data({ exists: true, profiles: [p], active: 'vpnp_1' }));
  assert.equal(some.length, 1);
});
