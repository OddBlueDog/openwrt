// The banIP page's model: its option spec against the router's
// (banip-options.json), values checked as the router checks them, saves of
// only what changed, a feed's direction, the presets, the memory estimate and
// its guard, the lists' lines as banIP reads them, address arithmetic for the
// self-lockout check, the drops and banIP's log lines in words (real lines
// from the VM), the schedule, and the custom feed form.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BanipStatus, Drop, Meta } from '../src/features/banip/api.ts';
import { checkFeedForm, definitionOf, type FeedForm } from '../src/features/banip/feed-form.ts';
import { PRESETS } from '../src/features/banip/feeds.ts';
import {
  countryWarnings,
  daySeries,
  describeDrop,
  describeState,
  estimate,
  feedDirection,
  formatEntry,
  insideConflicts,
  limitText,
  ipBytes,
  lineOwner,
  memoryCheck,
  needsKey,
  overlaps,
  parseEntry,
  parseLogLine,
  parseNet,
  portLimit,
  presetOf,
  RESULTS,
  scheduleText,
  selectionOf,
  serviceOf,
  summarize,
  turnOnText,
  withDirection,
  withPreset,
} from '../src/features/banip/model.ts';
import {
  checkValue,
  ITEMS,
  MILKFLINT,
  needsRestart,
  type OptionName,
  OPTIONS,
  type Options,
  optionChanges,
} from '../src/features/banip/options.ts';

const routerSpec = JSON.parse(
  readFileSync(
    new URL('../../../package/milkflint/milkflint-ui/files/features/banip/bin/banip-options.json', import.meta.url),
    'utf8',
  ),
) as {
  options: Record<string, Record<string, unknown>>;
  items: Record<string, string>;
  milkflint: Record<string, Record<string, unknown>>;
};
const routerMeta = JSON.parse(
  readFileSync(
    new URL('../../../package/milkflint/milkflint-ui/files/features/banip/bin/banip-meta.json', import.meta.url),
    'utf8',
  ),
) as Meta;

test('the page’s option spec is the router’s, option by option', () => {
  assert.deepEqual(Object.keys(OPTIONS).sort(), Object.keys(routerSpec.options).sort());
  for (const [name, o] of Object.entries(routerSpec.options)) {
    const mine = OPTIONS[name as OptionName] as unknown as Record<string, unknown>;
    for (const k of ['type', 'default', 'min', 'max', 'values', 'pattern', 'item', 'apply', 'refetch', 'check'])
      assert.deepEqual(mine[k], o[k], `${name}.${k}`);
  }
  assert.deepEqual(ITEMS, routerSpec.items);
  for (const [name, o] of Object.entries(routerSpec.milkflint)) {
    const mine = MILKFLINT[name as keyof typeof MILKFLINT] as unknown as Record<string, unknown>;
    for (const k of ['type', 'default', 'min', 'max', 'values', 'pattern'])
      assert.deepEqual(mine[k], o[k], `milkflint.${name}.${k}`);
  }
});

test('values are checked as banIP takes them', () => {
  assert.equal(checkValue('ban_debug', '1'), null);
  assert.equal(checkValue('ban_debug', 'yes'), 'bool');
  assert.equal(checkValue('ban_triggerdelay', '300'), null);
  assert.equal(checkValue('ban_triggerdelay', '301'), 'range');
  assert.equal(checkValue('ban_nicelimit', '-20'), null);
  assert.equal(checkValue('ban_nicelimit', '1e3'), 'range');
  assert.equal(checkValue('ban_blockpolicy', 'reject'), null);
  assert.equal(checkValue('ban_blockpolicy', 'accept'), 'value');
  assert.equal(checkValue('ban_basedir', '/mnt/usb/banIP'), null);
  assert.equal(checkValue('ban_basedir', '/tmp/../etc'), 'path');
  assert.equal(checkValue('ban_basedir', 'tmp'), 'path');
  assert.equal(checkValue('ban_allowflag', 'tcp udp 80 443-445'), null);
  assert.equal(checkValue('ban_allowflag', 'tcp 70000'), 'range');
  assert.equal(checkValue('ban_allowflag', 'tcp 445-443'), 'range');
  assert.equal(checkValue('ban_allowflag', 'tcp; reboot'), 'format');
  assert.equal(checkValue('ban_nftexpiry', '1h30m'), null);
  assert.equal(checkValue('ban_nftexpiry', '0s'), 'format');
  assert.equal(checkValue('ban_mailreceiver', 'me@example.org'), null);
  assert.equal(checkValue('ban_mailreceiver', 'me@example.org\nBcc: x@y.z'), 'format');
  assert.equal(checkValue('ban_resolver', '9.9.9.9'), null);
  assert.equal(checkValue('ban_resolver', '999.9.9.9'), 'format');
  const ctx = { feeds: new Set(['debl', 'cinsscore']), countries: new Set(['de', 'gb']) };
  assert.equal(checkValue('ban_feed', ['debl', 'cinsscore'], ctx), null);
  assert.equal(checkValue('ban_feed', ['debl', 'nosuch'], ctx), 'feed');
  assert.equal(checkValue('ban_feed', ['debl', 'debl'], ctx), 'duplicate');
  assert.equal(checkValue('ban_feedin', ['allowlist'], ctx), null);
  assert.equal(checkValue('ban_country', ['gb'], ctx), null);
  assert.equal(checkValue('ban_country', ['uk'], ctx), 'country');
  assert.equal(checkValue('ban_asn', ['64496'], ctx), null);
  assert.equal(checkValue('ban_asn', ['4294967296'], ctx), 'item');
  assert.equal(checkValue('ban_logterm', ['first:"GET /wp-login'], ctx), null);
  assert.equal(checkValue('ban_logterm', ['(unclosed'], ctx), 'regex');
  assert.equal(checkValue('ban_feed', 'debl'), 'type');
  assert.equal(checkValue('ban_debug', ['1']), 'type');
});

test('a save sends only what changed: a new value, or null to go back to banIP’s default', () => {
  const saved: Options = { ban_feed: ['debl'], ban_icmplimit: '0', ban_debug: null, ban_country: [] };
  assert.deepEqual(optionChanges(saved, { ...saved }), {});
  assert.deepEqual(optionChanges(saved, { ...saved, ban_feed: ['debl', 'turris'] }), { ban_feed: ['debl', 'turris'] });
  assert.deepEqual(optionChanges(saved, { ...saved, ban_feed: [] }), { ban_feed: null });
  assert.deepEqual(optionChanges(saved, { ...saved, ban_icmplimit: null }), { ban_icmplimit: null });
  assert.deepEqual(optionChanges(saved, { ...saved, ban_debug: '1' }), { ban_debug: '1' });
  // an empty list stays as unset as it was
  assert.deepEqual(optionChanges(saved, { ...saved, ban_country: [] }), {});
  assert.deepEqual(optionChanges(saved, { ban_vlanallow: [] }), {});
  assert.equal(needsRestart({ ban_feed: ['x'] }), true);
  assert.equal(needsRestart({ ban_mailreceiver: 'a@b.cd' }), false);
});

test('a feed’s direction: its own, unless banIP is told otherwise (ban_feedin, …out, …inout)', () => {
  const doh = { chain: 'out' };
  const debl = { chain: 'in' };
  assert.equal(feedDirection('doh', doh, {}), 'out');
  assert.equal(feedDirection('debl', debl, { ban_feedinout: ['debl'] }), 'inout');
  // set to its own direction: in no list
  const o = withDirection({ ban_feedout: ['debl'] }, 'debl', 'in', debl);
  assert.deepEqual([o.ban_feedin, o.ban_feedout, o.ban_feedinout], [[], [], []]);
  const both = withDirection({}, 'debl', 'inout', debl);
  assert.deepEqual(both.ban_feedinout, ['debl']);
  assert.equal(feedDirection('debl', debl, both), 'inout');
  assert.deepEqual(portLimit('tcp udp 80 443'), { protocols: ['tcp', 'udp'], ports: ['80', '443'] });
  assert.equal(portLimit('gz'), null);
});

test('presets: recognised by their lists, keeping countries and networks when chosen', () => {
  const rec = PRESETS.find((p) => p.id === 'recommended')?.feeds ?? [];
  assert.equal(presetOf({ ban_feed: [...rec].reverse() }, true), 'recommended');
  assert.equal(presetOf({ ban_feed: rec }, false), 'off');
  assert.equal(presetOf({ ban_feed: [...rec, 'country'], ban_country: ['ru'] }, true), 'custom');
  assert.equal(presetOf({ ban_feed: rec, ban_feedout: ['debl'] }, true), 'custom');
  const strict = withPreset({ ban_feed: ['debl', 'country'], ban_country: ['ru'], ban_feedinout: ['country', 'debl'] }, 'strict');
  assert.ok((strict.ban_feed as string[]).includes('country'));
  assert.ok((strict.ban_feed as string[]).includes('firehol1'));
  assert.deepEqual(strict.ban_feedinout, ['country']);
  assert.deepEqual(strict.ban_country, ['ru']);
  assert.equal(presetOf(strict, true), 'custom');
  assert.equal(presetOf(withPreset({}, 'strict'), true), 'strict');
});

const meta: Meta = {
  bytes: { kept: 125, copy: 24, counter_base: 34, counter_per_cpu: 16, load: 400, load_base: 6000000, run: 32000000 },
  asn_entries: 500,
  unknown_entries: 5000,
  feeds: { debl: { v4: 20000, v6: 200, kb: 300 }, big: { v4: 300000, kb: 4000 }, small: { v4: 1000, kb: 10 } },
  countries: { de: { v4: 9000, v6: 3000 }, fr: { v4: 6000, v6: 2000 } },
};

test('the memory a selection needs: what’s kept, and the biggest lists loading at once', () => {
  const sel = selectionOf({ ban_feed: ['debl', 'big', 'small'] }, new Map());
  const e = estimate(sel, meta, {}, 4);
  assert.equal(e.entries, 20000 + 200 + 300000 + 1000);
  assert.equal(e.perEntry, 125 + 24);
  assert.equal(e.keptKb, Math.floor((321200 * 149) / 1024));
  // four cores: all four sets load together
  assert.equal(e.loadKb, Math.floor(((300000 + 20000 + 1000 + 200) * 400 + 4 * 6000000 + 32000000) / 1024));
  assert.equal(e.downloadKb, 4310);
  // a split loads a big list a part at a time
  const split = estimate({ ...sel, split: 8192, cores: 1 }, meta, {}, 4);
  assert.equal(split.loadKb, Math.floor((8192 * 400 + 6000000 + 32000000) / 1024));
  // counting adds each CPU's counter
  assert.equal(estimate({ ...sel, counters: true }, meta, {}, 4).perEntry, 149 + 34 + 64);
  // a list's real size, once loaded, rather than the typical one
  assert.equal(estimate(sel, meta, { 'big.v4': 5 }, 4).entries, 20000 + 200 + 5 + 1000);
  // an unknown list: a guess; countries and their regions; networks by number
  assert.equal(estimate(selectionOf({ ban_feed: ['nosuch'] }, new Map()), meta, {}, 1).entries, 5000);
  const regions = new Map([
    ['de', 'RIPE'],
    ['fr', 'RIPE'],
  ]);
  assert.equal(estimate(selectionOf({ ban_feed: ['country'], ban_region: ['RIPE'] }, regions), meta, {}, 1).entries, 20000);
  assert.equal(estimate(selectionOf({ ban_feed: ['asn'], ban_asn: ['1', '2'] }, regions), meta, {}, 1).entries, 2000);
  // IPv4 only: no IPv6 sets
  assert.equal(
    estimate(selectionOf({ ban_feed: ['debl'], ban_autodetect: '0', ban_protov4: '1', ban_protov6: '0' }, new Map()), meta, {}, 1)
      .entries,
    20000,
  );
});

test('the memory guard: what stays free while loading, against a reserve of 15 % (96 MB at least)', () => {
  const mem = { total_kb: 1024 * 1024, available_kb: 700 * 1024 };
  const e = estimate(selectionOf({ ban_feed: ['debl'] }, new Map()), meta, {}, 4);
  const ok = memoryCheck(e, mem, 0, 149);
  assert.equal(ok.reserveKb, Math.floor(1024 * 1024 * 0.15));
  assert.ok(ok.ok);
  const huge = { ...e, keptKb: 400 * 1024, loadKb: 200 * 1024 };
  assert.equal(memoryCheck(huge, mem, 0, 125).ok, false);
  // the lists loaded now are dropped first
  assert.ok(memoryCheck(huge, mem, 1_000_000, 125).ok);
  assert.equal(memoryCheck(e, { total_kb: 256 * 1024, available_kb: 150 * 1024 }, 0, 125).reserveKb, 98304);
  assert.ok(estimate(selectionOf({ ban_feed: PRESETS[1]?.feeds ?? [] }, new Map()), routerMeta, {}, 4).entries > 10000);
});

test('list lines as banIP reads them', () => {
  assert.deepEqual(parseEntry('1.2.3.4'), { kind: 'v4', value: '1.2.3.4', comment: null });
  assert.deepEqual(parseEntry('10.0.0.0/8   # home'), { kind: 'v4', value: '10.0.0.0/8', comment: 'home' });
  assert.equal(parseEntry('2001:DB8::/32').value, '2001:db8::/32');
  assert.equal(parseEntry('example.com # a name').kind, 'domain');
  assert.equal(parseEntry('# just a comment').kind, 'comment');
  assert.equal(parseEntry('   ').kind, 'blank');
  const mac = parseEntry('C8:C2:9B:F7:80:12 192.168.1.10');
  assert.equal(mac.kind, 'mac');
  assert.equal(mac.ip4, '192.168.1.10');
  assert.equal(parseEntry('c8:c2:9b:f7:80:12/24').kind, 'mac');
  assert.equal(parseEntry('c8:c2:9b:f7:80:12 2001:db8::1').ip6, '2001:db8::1');
  for (const [bad, why] of [
    ['01.2.3.4', 'address'],
    ['1.2.3.4/33', 'address'],
    ['127.0.0.1', 'address'],
    ['0.0.0.0/0', 'address'],
    ['fe80::1', 'address'],
    ['::ffff:1.2.3.4', 'address'],
    ['::1', 'address'],
    [' 1.2.3.4', 'indent'],
    ['1.2.3.4 5.6.7.8', 'extra'],
    ['not an entry!', 'unknown'],
  ] as const) {
    const e = parseEntry(bad);
    assert.equal(e.kind, 'invalid', bad);
    assert.equal(e.reason, why, bad);
  }
  const s = summarize(
    ['1.2.3.4', '10.0.0.0/8', 'aa:bb:cc:dd:ee:ff', 'x.org', 'bad!', '192.168.1.0/24  # milkflint: inside network lan'].map(
      parseEntry,
    ),
  );
  assert.deepEqual(s, { addresses: 1, networks: 2, devices: 1, names: 1, problems: 1, managed: 1 });
  assert.equal(formatEntry('1.2.3.4', 'why'), `${'1.2.3.4'.padEnd(45)}# why`);
  assert.equal(lineOwner('uplink added on 2026-01-01 00:00:00'), 'uplink');
  assert.equal(lineOwner("'example.com' added on 2026-01-01 00:00:00"), 'lookup');
  assert.equal(lineOwner('added on 2026-01-01 00:00:00'), 'monitor');
  assert.equal(lineOwner('milkflint: inside network lan'), 'milkflint');
  assert.equal(lineOwner('mine'), 'you');
});

test('addresses: bytes, networks and whether they overlap; blocklist lines on your own network', () => {
  assert.deepEqual(ipBytes('192.168.1.1'), [192, 168, 1, 1]);
  assert.equal(ipBytes('2001:db8::1')?.length, 16);
  assert.equal(ipBytes('2001:db8::1')?.[15], 1);
  assert.equal(ipBytes('1:2:3:4:5:6:7:8:9'), null);
  assert.equal(ipBytes('300.1.1.1'), null);
  assert.ok(overlaps(parseNet('192.168.1.0/24'), parseNet('192.168.1.7')));
  assert.ok(overlaps(parseNet('192.168.0.0/16'), parseNet('192.168.1.0/24')));
  assert.ok(!overlaps(parseNet('192.168.2.0/24'), parseNet('192.168.1.7')));
  assert.ok(!overlaps(parseNet('2001:db8::/32'), parseNet('192.168.1.7')));
  assert.ok(overlaps(parseNet('fd00::/8'), parseNet('fdbe:e6c4:3cc5::/60')));
  const inside = [
    { iface: 'lan', net: '192.168.1.0/24' },
    { iface: 'lan', net: 'fdbe:e6c4:3cc5::/60' },
  ];
  const hits = insideConflicts(
    ['192.168.1.20', '8.8.8.8', '192.168.0.0/16', 'fdbe:e6c4:3cc5:1::5', 'example.com'].map(parseEntry),
    inside,
  );
  assert.deepEqual(
    hits.map((h) => h.value),
    ['192.168.1.20', '192.168.0.0/16', 'fdbe:e6c4:3cc5:1::5'],
  );
});

// lines as the VM's banIP wrote them (logread)
const LOG = [
  'Sun Nov 15 12:58:58 2026 user.info banIP-1.9.1-r2[8406]: start banIP processing (start, 1.9.1-r2)',
  "Sun Nov 15 12:58:58 2026 user.info banIP-1.9.1-r2[8406]: add uplink '10.0.2.15/24' to local allowlist",
  'Sun Nov 15 12:58:34 2026 user.err banIP-1.9.1-r2[7969]: banIP is disabled',
  'Sun Nov 15 13:01:24 2026 kern.warn kernel: [  278.102755] banIP/outbound/reject/spamhaus.v4: IN=br-lan OUT=eth1 MAC=52:54:00:12:34:56:02:00:00:00:03:00:08:00 SRC=192.168.1.159 DST=1.32.128.1 LEN=84 TOS=0x00 PREC=0x00 TTL=63 ID=26897 DF PROTO=ICMP TYPE=8 CODE=0 ID=21754 SEQ=0',
  'Sun Nov 15 13:01:25 2026 [1794747685.485] kern.warn kernel: [  279.119143] banIP/outbound/reject/spamhaus.v4: IN=br-lan OUT=eth1 MAC=52:54:00:12:34:56:02:00:00:00:03:00:08:00 SRC=192.168.1.159 DST=1.32.128.1 LEN=60 TOS=0x00 PREC=0x00 TTL=63 ID=23411 DF PROTO=TCP SPT=39948 DPT=80 WINDOW=64240 RES=0x00 SYN URGP=0',
  'Sun Nov 15 13:02:00 2026 daemon.info dnsmasq[123]: started',
];

test('banIP’s log lines: its own, its drops, and the rest', () => {
  const [start, uplink, err, ping, web, other] = LOG.map(parseLogLine);
  assert.equal(start?.kind, 'banip');
  assert.equal(start.message, 'start banIP processing (start, 1.9.1-r2)');
  assert.equal(uplink?.kind, 'banip');
  assert.equal(err?.level, 'err');
  assert.equal(ping?.kind, 'drop');
  assert.deepEqual([ping.drop?.dir, ping.drop?.policy, ping.drop?.set], ['outbound', 'reject', 'spamhaus.v4']);
  assert.equal(ping.drop?.fields['SRC'], '192.168.1.159');
  // the first ID= (the IP header's), not ICMP's
  assert.equal(ping.drop.fields['ID'], '26897');
  assert.equal(web?.drop?.fields['DPT'], '80');
  assert.equal(web.time, 'Sun Nov 15 13:01:25 2026');
  assert.equal(other?.kind, 'other');
  assert.equal(parseLogLine('garbage'), null);
});

const drop = (over: Partial<Drop>): Drop => ({
  t: 1794747685,
  dir: 'out',
  kind: '',
  policy: 'reject',
  set: 'spamhaus.v4',
  in: 'br-lan',
  out: 'eth1',
  src: '192.168.1.159',
  dst: '1.32.128.1',
  proto: 'tcp',
  sport: '39948',
  dport: '80',
  mac: '02:00:00:00:03:00',
  ...over,
});

test('drops in words: which way, the address outside, the service', () => {
  assert.deepEqual(describeDrop(drop({})), {
    direction: 'From your network',
    outside: '1.32.128.1',
    inside: '192.168.1.159',
    service: 'web (TCP 80)',
  });
  assert.equal(serviceOf(drop({ proto: 'icmp', sport: '8', dport: '0' })), 'ping');
  assert.equal(serviceOf(drop({ proto: 'udp', dport: '51820' })), 'WireGuard (UDP 51820)');
  assert.equal(serviceOf(drop({ proto: 'tcp', dport: '6000' })), 'TCP 6000');
  const knock = describeDrop(
    drop({ dir: 'in', policy: 'drop', in: 'eth1', out: '', src: '203.0.113.9', dst: '10.0.2.15', dport: '22' }),
  );
  assert.deepEqual(knock, { direction: 'To the router', outside: '203.0.113.9', inside: null, service: 'SSH (TCP 22)' });
  assert.equal(describeDrop(drop({ dir: 'in', out: 'br-lan', src: '203.0.113.9', dst: '192.168.1.5' })).direction, 'To a device');
  assert.equal(describeDrop(drop({ dir: 'pre', kind: 'syn', src: '203.0.113.9' })).direction, 'SYN flood');
});

const status = (over: Partial<BanipStatus>): BanipStatus => ({ installed: true, enabled: true, state: 'protecting', ...over });

test('its state in words', () => {
  assert.equal(describeState(status({})).label, 'Protecting');
  assert.equal(describeState(status({ state: 'off', enabled: false })).label, 'Off');
  assert.match(describeState(status({ state: 'updating', run: { stage: 'lists', done: 3, expected: 7 } })).text, /3 of 7/);
  assert.match(describeState(status({ state: 'error', reason: 'no wan interfaces' })).text, /internet connection/);
  assert.match(describeState(status({ state: 'error', reason: 'table_missing' })).text, /removed/);
  assert.match(describeState(status({ state: 'error', reason: 'something odd' })).text, /something odd/);
  assert.equal(describeState(status({ state: 'ap' })).label, 'Not used');
});

test('countries, the day of drops, the schedule', () => {
  assert.deepEqual(countryWarnings(['ru', 'gb'], 'GB'), ['gb']);
  assert.deepEqual(countryWarnings(['ru'], 'gb'), []);
  assert.deepEqual(countryWarnings(['ru'], null), []);
  const d = daySeries([1, 2, 3]);
  assert.equal(d.length, 288);
  assert.deepEqual(d.slice(-3), [1, 2, 3]);
  assert.equal(daySeries(Array<number>(400).fill(1)).length, 288);
  assert.equal(scheduleText('daily', '03:31', 0), 'Every day at 03:31');
  assert.equal(scheduleText('weekly', '04:00', 2), 'Tuesdays at 04:00');
  assert.equal(scheduleText('off', '04:00', 0), 'Not updated on a schedule');
});

test('a list of your own: banIP’s checks of its fields', () => {
  const f: FeedForm = {
    name: 'mylist',
    descr: 'my own list',
    url_4: 'https://example.org/l.txt',
    url_6: '',
    rule: 'feed 1',
    chain: 'in',
    flag: '',
  };
  assert.deepEqual(checkFeedForm(f, ['debl'], false), {});
  assert.deepEqual(definitionOf(f), { url_4: 'https://example.org/l.txt', rule: 'feed 1', chain: 'in', descr: 'my own list' });
  assert.ok(checkFeedForm({ ...f, name: 'debl' }, ['debl'], false).name !== undefined);
  assert.ok(checkFeedForm({ ...f, name: 'My-List' }, [], false).name !== undefined);
  assert.ok(checkFeedForm({ ...f, url_4: '' }, [], false).url_4 !== undefined);
  assert.ok(checkFeedForm({ ...f, url_4: 'ftp://x.y/z' }, [], false).url_4 !== undefined);
  assert.ok(checkFeedForm({ ...f, url_4: 'https://x.y/$(reboot)' }, [], false).url_4 !== undefined);
  assert.ok(checkFeedForm({ ...f, rule: 'feed 4 "' }, [], false).rule === undefined);
  assert.ok(checkFeedForm({ ...f, rule: 'awk 1' }, [], false).rule !== undefined);
  assert.ok(checkFeedForm({ ...f, flag: 'gz tcp udp 80 443' }, [], false).flag === undefined);
  assert.ok(checkFeedForm({ ...f, flag: 'gz; reboot' }, [], false).flag !== undefined);
  assert.ok(checkFeedForm({ ...f, descr: 'a "quote"' }, [], false).descr !== undefined);
});

test('while off, the page says what turning banIP on starts', () => {
  // nothing chosen: the switch starts the Recommended lists
  assert.match(turnOnText(true), /Recommended lists/);
  assert.match(turnOnText(false), /chosen under Protection/);
  for (const t of [turnOnText(true), turnOnText(false)]) {
    assert.match(t, /memory/);
    // no figures in the page's words
    assert.doesNotMatch(t, /\d/);
  }
});

test('a list limited to some ports says so in words', () => {
  const l = portLimit('tcp udp 5060');
  assert.ok(l !== null);
  assert.equal(limitText(l), 'TCP and UDP ports 5060');
  const web = portLimit('tcp 80 443');
  assert.ok(web !== null);
  assert.equal(limitText(web), 'TCP ports 80, 443 (web)');
});

test('a list that needs a personal key (urlhaus since banIP 1.9.1-r3): found by its address, the key checked as banIP takes it', () => {
  const feeds = JSON.parse(
    readFileSync(new URL('../../../package/milkflint/banip/files/banip.feeds', import.meta.url), 'utf8'),
  ) as Record<string, { url_4?: string; url_6?: string }>;
  const keyed = Object.entries(feeds)
    .filter(([, f]) => needsKey(f))
    .map(([name]) => name);
  assert.deepEqual(keyed, ['urlhaus']);
  assert.equal(needsKey({ url_4: 'https://example.org/list.txt', url_6: null }), false);
  assert.equal(needsKey({ url_6: 'https://example.org/{authkey}/v6.txt' }), true);
  // banIP skips the list unless the key is letters, digits, - and _ (banip-service.sh)
  assert.equal(checkValue('ban_authkey', 'a1B2-c3_D4'), null);
  assert.equal(checkValue('ban_authkey', 'abc def'), 'format');
  assert.equal(checkValue('ban_authkey', 'abc/../x'), 'format');
  assert.equal(checkValue('ban_authkey', "abc'; reboot"), 'format');
  assert.equal(checkValue('ban_authkey', ''), 'format');
  assert.equal(needsRestart({ ban_authkey: 'abc' }), true);
  assert.match(RESULTS['nokey'] ?? '', /Auth-Key/);
});
