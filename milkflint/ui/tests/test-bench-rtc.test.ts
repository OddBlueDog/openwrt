// The test bench's device-to-device tests: candidates read from SDP without
// their addresses, signal keys, the likely reasons for no direct path, and
// a pair's figures from both ends' records (loss each way, throughput per
// direction, RTT at rest).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Phase } from '../src/features/test-bench/api.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import { directionLoss, linkStatus, pairResults, schedulePairs } from '../src/features/test-bench/pairs.ts';
import { buildPlan, defaultCustom, type PlanMember, usesInternet } from '../src/features/test-bench/plans.ts';
import { offers, pairKey, parsePairKey, partnersOf } from '../src/features/test-bench/rtc.ts';
import {
  addressKind,
  countCandidates,
  type LinkDiag,
  noPathCauses,
  pathIsLocal,
  pathNotes,
  pathText,
  sdpCandidates,
  type Side,
} from '../src/features/test-bench/rtc-diag.ts';
import { memberRecords } from '../src/features/test-bench/timing.ts';

// ---- Candidates ----

test('addresses are only ever kept as their kind', () => {
  assert.equal(addressKind('6f2c1a4e-0b6d-4c1e-9f0a-3f1c2b7d8e90.local'), 'mdns');
  assert.equal(addressKind('192.168.1.23'), 'lan');
  assert.equal(addressKind('172.20.0.4'), 'lan');
  assert.equal(addressKind('172.32.0.4'), 'public');
  assert.equal(addressKind('10.0.0.1'), 'lan');
  assert.equal(addressKind('169.254.3.3'), 'link-local');
  assert.equal(addressKind('100.101.102.103'), 'cgnat');
  assert.equal(addressKind('8.8.8.8'), 'public');
  assert.equal(addressKind('fe80::1c2b:3cff:fe4d:5e6f'), 'link-local');
  assert.equal(addressKind('fd12:3456::1'), 'ula');
  assert.equal(addressKind('2a01:4b00::1'), 'global');
  assert.equal(addressKind('::1'), 'loopback');
  assert.equal(addressKind(''), 'hidden');
  assert.equal(addressKind(undefined), 'hidden');
});

const offerSdp = [
  'v=0',
  'a=candidate:1 1 udp 2122260223 6f2c1a4e-0b6d-4c1e-9f0a-3f1c2b7d8e90.local 54321 typ host generation 0',
  'a=candidate:2 1 tcp 1518280447 6f2c1a4e-0b6d-4c1e-9f0a-3f1c2b7d8e90.local 9 typ host tcptype active generation 0',
  'a=candidate:3 1 UDP 1686052607 81.2.69.160 40000 typ srflx raddr 0.0.0.0 rport 0',
  // RTP's second component, which a data channel doesn't use
  'a=candidate:1 2 udp 2122260222 192.168.1.23 54322 typ host',
  'a=candidate:junk',
].join('\r\n');

test("an SDP's candidates, by type, protocol and address kind", () => {
  const cs = sdpCandidates(offerSdp);
  assert.deepEqual(cs, [
    { type: 'host', protocol: 'udp', kind: 'mdns' },
    { type: 'host', protocol: 'tcp', kind: 'mdns' },
    { type: 'srflx', protocol: 'udp', kind: 'public' },
  ]);
  assert.deepEqual(countCandidates(cs), { 'host/udp/mdns': 1, 'host/tcp/mdns': 1, 'srflx/udp/public': 1 });
  assert.deepEqual(sdpCandidates(undefined), []);
  // nothing of an address survives
  assert.ok(!JSON.stringify(cs).includes('81.2'));
});

test('a path in words, and whether it stays on the home network', () => {
  const path = { local: 'host/udp/lan', remote: 'prflx/udp/lan', rtt: 1.2 };
  assert.equal(pathText(path), 'UDP, host (LAN) to peer-reflexive (LAN)');
  // Chrome's stats hide the addresses of mDNS candidates: the types alone
  assert.equal(pathText({ local: 'host/udp/hidden', remote: 'prflx/udp/hidden', rtt: null }), 'UDP, host to peer-reflexive');
  assert.ok(pathIsLocal(path));
  assert.deepEqual(pathNotes(path), []);
  const vpn = { local: 'host/udp/cgnat', remote: 'host/udp/cgnat', rtt: 30 };
  assert.ok(!pathIsLocal(vpn));
  assert.equal(pathNotes(vpn).length, 1);
  assert.match(pathNotes({ local: 'host/tcp/lan', remote: 'host/tcp/mdns', rtt: null }).join(' '), /TCP/);
});

// ---- Signalling ----

test('signal keys name the run, the pair (lower id first) and the attempt, within the router’s 24 characters', () => {
  const k = pairKey('a1b2c3', 'm12', 'm3', 'p', 2);
  assert.equal(k, 'a1b2c3-m3-m12-p2');
  assert.deepEqual(parsePairKey(k), { tag: 'a1b2c3', lo: 'm3', hi: 'm12', kind: 'p', attempt: 2 });
  assert.ok(pairKey('ffffff', 'm998', 'm999', 'b', 99).length <= 24);
  assert.equal(parsePairKey('a1b2c3-m3-m12-x2'), undefined);
  assert.equal(parsePairKey('m3-m12-p2'), undefined);
  // the lower id offers, by number, not by text
  assert.ok(offers('m9', 'm10'));
  assert.ok(!offers('m10', 'm9'));
});

test('a member connects with every partner a phase pairs it with', () => {
  const phases: { pair?: [string, string] }[] = [{ pair: ['m1', 'm2'] }, { pair: ['m2', 'm1'] }, { pair: ['m3', 'm2'] }, {}, { pair: ['m3', 'm4'] }];
  assert.deepEqual(partnersOf(phases, 'm2'), ['m1', 'm3']);
  assert.deepEqual(partnersOf(phases, 'm5'), []);
  assert.deepEqual(schedulePairs(phases), [
    ['m1', 'm2'],
    ['m3', 'm2'],
    ['m3', 'm4'],
  ]);
});

// ---- Plans ----

const mac: PlanMember = { id: 'm1', name: 'Mac', wired: true };
const phone: PlanMember = { id: 'm2', name: 'iPhone', wired: false };
const pc: PlanMember = { id: 'm3', name: 'PC', wired: true };
const tablet: PlanMember = { id: 'm4', name: 'iPad', wired: false };

test('one connect phase, before the first pair, for everyone any later phase pairs', () => {
  const { schedule } = buildPlan('full', [mac, phone, pc, tablet], false);
  const kinds = schedule.phases.map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === 'connect').length, 1);
  const connect = kinds.indexOf('connect');
  assert.ok(connect < kinds.indexOf('d2d'));
  const paired = new Set(schedule.phases.flatMap((p) => p.pair ?? []));
  assert.deepEqual(Object.keys(schedule.phases[connect]?.roles ?? {}).sort(), [...paired].sort());
  // the household's pair too
  const h = schedule.phases.find((p) => p.kind === 'household');
  for (const id of h?.pair ?? []) assert.equal(schedule.phases[connect]?.roles[id], 'rtc');
});

test("a custom busy household connects its pair first, even without device-to-device phases", () => {
  const { schedule } = buildPlan('custom', [mac, phone, pc, tablet], false, { ...defaultCustom, d2d: false, household: true });
  const kinds = schedule.phases.map((p) => p.kind);
  assert.ok(kinds.includes('connect') && kinds.indexOf('connect') < kinds.indexOf('household'));
  assert.deepEqual(schedule.phases[kinds.indexOf('connect')]?.roles, { m3: 'rtc', m4: 'rtc' });
  assert.ok(usesInternet(schedule));
  const d2dOnly = buildPlan('custom', [mac, phone], false, { ...defaultCustom, download: false, upload: false, dns: false, d2d: true });
  assert.ok(!usesInternet(d2dOnly.schedule));
  // three devices make no pair: no connect phase
  const three = buildPlan('custom', [mac, phone, pc], false, { ...defaultCustom, d2d: false, household: true });
  assert.ok(!three.schedule.phases.some((p) => p.kind === 'connect'));
});

// ---- Why no direct path ----

const diag = (over: Partial<LinkDiag> = {}): LinkDiag => ({
  offerer: false,
  sent: true,
  got: true,
  pc: 'failed',
  ice: 'failed',
  gathering: 'complete',
  dtls: 'new',
  local: { 'host/udp/mdns': 1 },
  remote: { 'host/udp/mdns': 1 },
  pairs: {},
  requestsSent: 0,
  requestsReceived: 0,
  responsesReceived: 0,
  path: null,
  error: null,
  ms: 15000,
  ...over,
});
const sideOf = (name: string, d: LinkDiag | undefined, over: Partial<Side> = {}): Side => ({ name, wifi: false, browser: 'Safari', os: 'macOS', diag: d, ...over });

test('no reports at all, or from one side', () => {
  assert.match(noPathCauses(sideOf('Mac', undefined), sideOf('iPhone', undefined))[0] ?? '', /Neither device/);
  assert.match(noPathCauses(sideOf('Mac', diag({ offerer: true })), sideOf('iPhone', undefined))[0] ?? '', /iPhone never reported/);
});

test('signalling that stopped short: the offer, its delivery, the answer', () => {
  const unsent = noPathCauses(sideOf('Mac', diag({ offerer: true, sent: false, got: false, error: 'mailbox full' })), sideOf('iPhone', diag({ got: false, sent: false })));
  assert.deepEqual(unsent, ["Mac's offer never reached the router (mailbox full)."]);
  const undelivered = noPathCauses(sideOf('Mac', diag({ offerer: true, got: false })), sideOf('iPhone', diag({ got: false, sent: false })));
  assert.match(undelivered[0] ?? '', /didn't reach iPhone/);
  const unanswered = noPathCauses(sideOf('Mac', diag({ offerer: true, got: false })), sideOf('iPhone', diag({ sent: false, error: 'boom' })));
  assert.match(unanswered[0] ?? '', /iPhone never answered \(boom\)/);
});

test('a browser that gives no addresses', () => {
  const c = noPathCauses(sideOf('Mac', diag({ offerer: true })), sideOf('PC', diag({ local: {} })));
  assert.match(c.join(' '), /PC's browser offered no addresses/);
});

test('only .local names and no checks at all point at mDNS', () => {
  const c = noPathCauses(sideOf('Mac', diag({ offerer: true })), sideOf('iPhone', diag()));
  assert.match(c[0] ?? '', /mDNS/);
});

test('checks that went out and none arrived point at something dropping them; Wi-Fi, Windows and Chrome hints follow', () => {
  const c = noPathCauses(
    sideOf('PC', diag({ offerer: true, requestsSent: 12, remote: { 'host/udp/lan': 1 } }), { os: 'Windows', browser: 'Chrome', wifi: true }),
    sideOf('iPhone', diag({ requestsSent: 9, remote: { 'host/udp/lan': 1 } }), { wifi: true }),
  );
  assert.match(c[0] ?? '', /none arrived/);
  assert.match(c.join(' '), /client isolation/);
  assert.match(c.join(' '), /Windows Defender Firewall/);
  assert.match(c.join(' '), /PC's Chrome may have asked/);
  assert.match(c[c.length - 1] ?? '', /VPN/);
});

test('one-way checks name the side whose replies were lost', () => {
  const c = noPathCauses(
    sideOf('PC', diag({ offerer: true, requestsSent: 12, responsesReceived: 0 })),
    sideOf('Mac', diag({ requestsSent: 10, requestsReceived: 12, responsesReceived: 0 })),
  );
  assert.match(c[0] ?? '', /One way only: PC's checks reached Mac/);
});

test('ICE connected but DTLS failed', () => {
  const c = noPathCauses(sideOf('Mac', diag({ offerer: true, ice: 'connected', dtls: 'failed' })), sideOf('iPhone', diag({ ice: 'connected', dtls: 'failed' })));
  assert.deepEqual(c, ['ICE found a path, but the DTLS handshake on it failed.']);
});

// ---- A pair's figures ----

const open = (offerer: boolean, path: LinkDiag['path'], ms = 900): LinkDiag => diag({ offerer, pc: 'connected', ice: 'connected', dtls: 'connected', path, ms });
const lan = { local: 'host/udp/lan', remote: 'prflx/udp/lan', rtt: 1 };

test('loss each way needs both ends: what arrived there, and the echoes back', () => {
  // m1 sent 0..9 to m2; m2 got all but 3 and 7; of the echoes, 5's didn't come back
  const a: RunRecord[] = [];
  for (let n = 0; n < 10; n++) a.push(['pp', 'm2', n, 1000 + n * 100, n === 3 || n === 7 || n === 5 ? null : 2]);
  // m2 sent 0..4 to m1; m1 got all of them; m2 heard all echoes except 1's
  const b: RunRecord[] = [['pr', 'm1', 2000, [0, 1, 2, 4, 5, 6, 8, 9]]];
  for (let n = 0; n < 5; n++) b.push(['pp', 'm1', n, 1000 + n * 100, n === 1 ? null : 2]);
  a.push(['pr', 'm2', 2000, [0, 1, 2, 3, 4]]);
  // m1 to m2: its 10 probes (3 and 7 lost) and the 5 echoes it sent back (1's lost)
  assert.deepEqual(directionLoss(a, b, 'm1', 'm2'), { sent: 15, lost: 3 });
  // m2 to m1: its 5 probes (none lost) and the 8 echoes of m1's that it got (5's lost)
  assert.deepEqual(directionLoss(b, a, 'm2', 'm1'), { sent: 13, lost: 1 });
  // without the far end's word on what arrived, there's no telling
  assert.equal(
    directionLoss(
      a,
      b.filter((r) => r[0] !== 'pr'),
      'm1',
      'm2',
    ),
    undefined,
  );
});

test("a link's status: opened on either end, the offerer's path first", () => {
  const a: RunRecord[] = [['peer', 1000, 'm2', 'p', 'open', open(true, lan, 800)]];
  const b: RunRecord[] = [
    ['peer', 1000, 'm1', 'p', 'open', open(false, { ...lan, rtt: 2 }, 700)],
    ['peer', 2000, 'm1', 'b', 'wait', diag()],
  ];
  const p = linkStatus(a, b, 'm1', 'm2', 'p');
  assert.ok(p.opened);
  assert.equal(p.ms, 800);
  assert.equal(p.path?.rtt, 1);
  assert.ok(!p.dropped);
  const bulk = linkStatus(a, b, 'm1', 'm2', 'b');
  assert.ok(!bulk.opened);
  // opened, then failed: it dropped
  a.push(['peer', 5000, 'm2', 'p', 'fail', diag({ offerer: true })]);
  assert.ok(linkStatus(a, b, 'm1', 'm2', 'p').dropped);
  assert.equal(bulk.a, undefined);
  assert.equal(bulk.b?.pc, 'failed');
});

test('a pair’s throughput per direction, its RTT under load and at rest', () => {
  const phases: Phase[] = [
    { kind: 'connect', start: 0, dur: 10_000, roles: { m1: 'rtc', m2: 'rtc' } },
    { kind: 'd2d', start: 10_000, dur: 10_000, roles: { m1: 'a', m2: 'b' }, pair: ['m1', 'm2'], dir: 'ab' },
    { kind: 'd2d', start: 20_000, dur: 10_000, roles: { m1: 'a', m2: 'b' }, pair: ['m1', 'm2'], dir: 'ba' },
  ];
  const t0 = 100_000;
  const a: RunRecord[] = [['peer', t0 + 1000, 'm2', 'p', 'open', open(true, lan)], ['peer', t0 + 1000, 'm2', 'b', 'open', open(true, lan)]];
  const b: RunRecord[] = [['peer', t0 + 1000, 'm1', 'p', 'open', open(false, lan)], ['peer', t0 + 1000, 'm1', 'b', 'open', open(false, lan)]];
  // at rest (the connect phase) 1 ms; under load 5 ms
  for (let t = t0 + 2000; t < t0 + 30_000; t += 100) a.push(['pp', 'm2', t, t, t < t0 + 10_000 ? 1 : 5]);
  // m2 receives 12.5 MB/s from m1 in the first d2d phase; m1 gets half that back in the second
  for (let t = t0 + 10_000; t < t0 + 20_000; t += 250) b.push(['pb', 'm1', t, 3_125_000]);
  for (let t = t0 + 20_000; t < t0 + 30_000; t += 250) a.push(['pb', 'm2', t, 1_562_500]);
  const [r] = pairResults(t0, t0 + 30_000, phases, new Map([
    ['m1', a],
    ['m2', b],
  ]));
  assert.ok(r !== undefined);
  assert.equal(r.ab.phases, 1);
  assert.equal(Math.round(r.ab.throughput?.mbit ?? 0), 100);
  assert.equal(Math.round(r.ba.throughput?.mbit ?? 0), 50);
  assert.equal(r.quiet.median, 1);
  assert.equal(r.ab.rtt.median, 5);
  // m2 sent no probes, so it reported none arriving: loss each way unknown
  assert.equal(r.loss.ab, undefined);
  assert.ok(r.probe.opened && r.bulk.opened);
});

// ---- The records a member sends ----

test("device-to-device records are checked before they're used", () => {
  const good: unknown[][] = [
    ['peer', 1000, 'm2', 'p', 'open', open(true, lan)],
    ['pp', 'm2', 0, 1000, 1.5],
    ['pp', 'm2', 1, 1100, null],
    ['pr', 'm2', 2000, [0, 1, 2]],
    ['pb', 'm2', 2000, 65536],
  ];
  const bad: unknown[][] = [
    ['peer', 1000, 'm2', 'p', 'open', { ...open(true, lan), local: null }],
    ['peer', 1000, 'm2', 'x', 'open', open(true, lan)],
    ['peer', 1000, 'nobody', 'p', 'open', open(true, lan)],
    ['pp', 'm2', 'zero', 1000, 1],
    ['pr', 'm2', 2000, [0, 'one']],
    ['pb', 'm2', 2000],
  ];
  const lines = [JSON.stringify({ m: 'm1', seq: 0, records: [...good, ...bad] })];
  assert.equal(memberRecords(lines).length, good.length);
});
