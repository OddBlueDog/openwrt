// The Nearby networks page's answer for each band: who shares its channels,
// whether a clearly quieter place exists, and which bands the last scan
// listened on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScannedNetwork, ScanState } from '../src/features/wifi-scan/api.ts';
import {
  ago,
  bandAnswer,
  blockLabel,
  howLong,
  quietestLabel,
  type Radio,
  scannedBands,
} from '../src/features/wifi-scan/model.ts';
import type { RegRule } from '../src/lib/api/wireless.ts';

const radio = (over: Partial<Radio> = {}): Radio => ({
  radio: 'radio0',
  band: '2g',
  phy: 'phy0',
  online: true,
  auto: false,
  channel: 6,
  span: [2427, 2447],
  width: 20,
  country: 'GB',
  ...over,
});

const fiveG = (over: Partial<Radio> = {}): Radio =>
  radio({ radio: 'radio1', band: '5g', phy: 'phy1', channel: 36, span: [5170, 5250], width: 80, ...over });

let next = 0;
function heard(band: '2g' | '5g', channel: number, signal: number | null, width = 20, center?: number): ScannedNetwork {
  const mhz = band === '2g' ? 2407 + 5 * channel : 5000 + 5 * channel;
  next++;
  return {
    bssid: `02:00:00:00:00:${String(next).padStart(2, '0')}`,
    ssid: `Net ${String(next)}`,
    mhz,
    band,
    channel,
    width,
    center: center ?? mhz,
    signal,
    standard: 'ax',
    security: { privacy: true, rsn: { ciphers: ['ccmp'], akm: ['psk'], mfp: null } },
    radio: band === '2g' ? 'phy0' : 'phy1',
  };
}

// GB's 5 GHz: 36–48 plain, 52–64 and 100–140 radar channels, 149–165 short-range devices
const rule = (start: number, end: number, dfs = false): RegRule => ({
  start,
  end,
  max_bw: 160,
  eirp: 23,
  indoor_only: false,
  dfs,
  no_ir: false,
  auto_bw: false,
});
const gb: RegRule[] = [rule(2400, 2483.5), rule(5150, 5250), rule(5250, 5350, true), rule(5470, 5725, true), rule(5725, 5875)];

test('a band that’s off, or that the last scan didn’t listen on, says so and nothing more', () => {
  const off = bandAnswer(radio({ span: undefined, channel: undefined }), [heard('2g', 6, -50)], gb, true);
  assert.equal(off.state, 'off');
  assert.equal(off.where, undefined);
  const unscanned = bandAnswer(radio(), [heard('2g', 6, -50)], gb, false);
  assert.equal(unscanned.state, 'unscanned');
  assert.equal(unscanned.where, 'channel 6');
  assert.equal(unscanned.sharing, 0);
});

test('nobody on its channel: clear, with what else the band holds', () => {
  const a = bandAnswer(
    radio({ channel: 1, span: [2402, 2422] }),
    [heard('2g', 11, -60), heard('5g', 36, -40, 80, 5210)],
    gb,
    true,
  );
  assert.equal(a.state, 'clear');
  assert.equal(a.sharing, 0);
  assert.equal(a.heard, 1);
  assert.equal(a.move, undefined);
});

test('a loud neighbour on its channel and a quiet one elsewhere: worth moving', () => {
  const loud = heard('2g', 6, -50);
  const a = bandAnswer(radio(), [loud, heard('2g', 5, -85), heard('2g', 11, -70)], gb, true);
  assert.equal(a.state, 'quieter');
  assert.equal(a.sharing, 2);
  assert.equal(a.loudest?.bssid, loud.bssid);
  assert.deepEqual(a.move, { channels: [1], dfs: false });
  assert.equal(a.where, 'channel 6');
});

test('neighbours everywhere alike: shared, and nowhere to move', () => {
  const a = bandAnswer(radio(), [heard('2g', 1, -70), heard('2g', 6, -70), heard('2g', 11, -70)], gb, true);
  assert.equal(a.state, 'shared');
  assert.equal(a.move, undefined);
  assert.notEqual(a.best, undefined);
});

test('5 GHz: blocks at its width, radar channels marked, a free narrower block offered when its width has none', () => {
  // busy 36–48 and 149–161, faint ones on the rest but 116 and 165, so nothing at 40 or 80 MHz is free
  const nets = [
    heard('5g', 36, -50, 80, 5210),
    heard('5g', 52, -88, 80, 5290),
    heard('5g', 100, -88, 80, 5530),
    heard('5g', 120, -88, 20, 5600),
    heard('5g', 124, -88, 40, 5630),
    heard('5g', 132, -88, 40, 5670),
    heard('5g', 140, -88, 20, 5700),
    heard('5g', 149, -60, 80, 5775),
  ];
  const a = bandAnswer(fiveG(), nets, gb, true);
  assert.equal(a.where, 'channels 36–48');
  assert.equal(a.state, 'quieter');
  assert.equal(a.move?.dfs, true);
  assert.deepEqual(a.free, {
    width: 20,
    blocks: [
      { channels: [116], dfs: true },
      { channels: [165], dfs: false },
    ],
  });
});

test('the bands a scan listened on: not the ones that failed; all of them from a router that doesn’t say', () => {
  const done = (radios: ScanState['radios']): ScanState => ({ state: 'done', now: 0, radios });
  const r = (band: string, error: string | null): NonNullable<ScanState['radios']>[number] => ({
    phy: 'phy0',
    ifname: null,
    band,
    mhz: null,
    width: null,
    center: null,
    error,
  });
  assert.deepEqual([...scannedBands(done([r('2g', null), r('5g', 'busy')]))], ['2g']);
  assert.deepEqual([...scannedBands(done(undefined))].sort(), ['2g', '5g', '6g']);
  assert.equal(scannedBands({ state: 'running', now: 0 }).size, 0);
  assert.equal(scannedBands(undefined).size, 0);
});

test('labels and ages', () => {
  assert.equal(blockLabel([36, 40, 44, 48]), '36–48');
  assert.equal(blockLabel([6]), '6');
  assert.equal(quietestLabel('2g', 40, [11]), 'Quietest channel: 11');
  assert.equal(quietestLabel('5g', 80, [149, 153, 157, 161]), 'Quietest 80 MHz block: 149–161');
  assert.equal(howLong(3 * 3600 + 5), '3 hours');
  assert.equal(howLong(60), '1 minute');
  assert.equal(ago(30), 'just now');
  assert.equal(ago(150), '2 min ago');
  assert.equal(ago(2 * 86400), '2 d ago');
});
