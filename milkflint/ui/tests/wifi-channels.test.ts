// The channels a network covers at each width, as OpenWrt's hostapd.uc bonds
// them, and the quietest place the Scan page suggests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockAround, blockOf, describeBlock, describeChannels, widthOf } from '../src/features/wifi/channels.ts';
import type { ScannedNetwork } from '../src/features/wifi-scan/api.ts';
import { coveredChannels, emptyNarrower, quietest } from '../src/features/wifi-scan/spectrum.ts';

test('2.4 GHz at 40 MHz pairs with the channel 4 away', () => {
  assert.deepEqual(blockOf('2g', 1, 40), [1, 5]);
  assert.deepEqual(blockOf('2g', 6, 40), [6, 10]);
  assert.deepEqual(blockOf('2g', 7, 40), [3, 7]);
  assert.deepEqual(blockOf('2g', 13, 40), [9, 13]);
  assert.deepEqual(blockOf('2g', 6, 20), [6]);
});

test('5 GHz bonds in fixed blocks: every channel in one gives the same block', () => {
  for (const c of [36, 40, 44, 48]) assert.deepEqual(blockOf('5g', c, 80), [36, 40, 44, 48]);
  for (const c of [52, 56, 60, 64]) assert.deepEqual(blockOf('5g', c, 80), [52, 56, 60, 64]);
  for (const c of [100, 104, 108, 112]) assert.deepEqual(blockOf('5g', c, 80), [100, 104, 108, 112]);
  for (const c of [149, 153, 157, 161]) assert.deepEqual(blockOf('5g', c, 80), [149, 153, 157, 161]);
  assert.deepEqual(blockOf('5g', 44, 40), [44, 48]);
  assert.deepEqual(blockOf('5g', 48, 40), [44, 48]);
  assert.deepEqual(blockOf('5g', 64, 160), [36, 40, 44, 48, 52, 56, 60, 64]);
  assert.deepEqual(blockOf('5g', 128, 160), [100, 104, 108, 112, 116, 120, 124, 128]);
  assert.deepEqual(blockOf('5g', 44, 20), [44]);
});

test('6 GHz counts from channel 1', () => {
  assert.deepEqual(blockOf('6g', 5, 80), [1, 5, 9, 13]);
  assert.deepEqual(blockOf('6g', 17, 80), [17, 21, 25, 29]);
  assert.equal(blockOf('6g', 37, 320).length, 16);
  assert.equal(blockOf('6g', 37, 320)[0], 1);
  assert.equal(blockOf('6g', 69, 320)[0], 65);
});

test('around a centre channel, as the radio reports it', () => {
  assert.deepEqual(blockAround(42, 80), [36, 40, 44, 48]);
  assert.deepEqual(blockAround(50, 160), [36, 40, 44, 48, 52, 56, 60, 64]);
  assert.deepEqual(blockAround(38, 40), [36, 40]);
  assert.deepEqual(blockAround(44, 20), [44]);
  assert.deepEqual(blockAround(44, 0), [44]);
});

test('in words', () => {
  assert.equal(describeBlock('5g', [149, 153, 157, 161]), '149–161 (5735–5815 MHz)');
  assert.equal(describeBlock('5g', [153]), '153 (5755–5775 MHz)');
  assert.equal(describeBlock('2g', [1]), '1 (2402–2422 MHz)');
  assert.equal(describeBlock('2g', [14]), '14 (2474–2494 MHz)');
  assert.equal(describeBlock('5g', []), '');
  assert.equal(widthOf('HE160'), 160);
  assert.equal(widthOf('VHT80'), 80);
  assert.equal(widthOf('NOHT'), 20);
  assert.equal(widthOf(undefined), 20);
  assert.equal(describeChannels([44]), 'channel 44');
  assert.equal(describeChannels([64, 36, 40, 44, 48, 52, 56, 60]), 'channels 36–64');
  assert.equal(describeChannels([52, 56, 60, 64, 100, 104, 108, 112]), 'channels 52–64 and 100–112');
  assert.equal(describeChannels([36, 44, 44, 52]), 'channels 36, 44 and 52');
});

const net = (band: ScannedNetwork['band'], center: number, width: number, signal: number | null = -60): ScannedNetwork =>
  ({ band, center, width, signal, channel: 0, mhz: center, bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'n', standard: 'ax', security: { privacy: true }, radio: 'phy0' });

test('the quietest place: nothing there, the first block', () => {
  assert.deepEqual(quietest('5g', 80, [], undefined), { channels: [36, 40, 44, 48], load: 0 });
  assert.deepEqual(quietest('2g', 20, [], undefined), { channels: [1], load: 0 });
});

test('a neighbour pushes it to the next block that’s clear', () => {
  const on36 = net('5g', 5210, 80);
  assert.deepEqual(quietest('5g', 80, [on36], undefined)?.channels, [52, 56, 60, 64]);
  assert.deepEqual(quietest('5g', 80, [on36, net('5g', 5290, 80)], undefined)?.channels, [100, 104, 108, 112]);
});

test('only the channels the radio may use; none allowed, no place', () => {
  const allowed = new Set([36, 40, 44, 48, 149, 153, 157, 161]);
  assert.deepEqual(quietest('5g', 80, [net('5g', 5210, 80)], allowed)?.channels, [149, 153, 157, 161]);
  assert.equal(quietest('5g', 80, [], new Set([36])), undefined);
  assert.equal(quietest('5g', 160, [], new Set([36, 40, 44, 48])), undefined);
});

test('another band’s networks don’t count', () => {
  assert.deepEqual(quietest('5g', 80, [net('2g', 2437, 20), net('6g', 6115, 80)], undefined), { channels: [36, 40, 44, 48], load: 0 });
});

test('a loud neighbour counts for more than a quiet one', () => {
  const allowed = new Set([36, 40, 44, 48, 52, 56, 60, 64]);
  const best = quietest('5g', 80, [net('5g', 5210, 80, -45), net('5g', 5290, 80, -85)], allowed);
  assert.deepEqual(best?.channels, [52, 56, 60, 64]);
  assert.ok(best.load > 0);
});

test('160 MHz blocks that fit are the only ones offered', () => {
  // 149 and up has no 160 MHz block in the band's channels
  const allowed = new Set([149, 153, 157, 161, 165]);
  assert.equal(quietest('5g', 160, [], allowed), undefined);
});

test('2.4 GHz: only 1, 6 and 11', () => {
  assert.deepEqual(quietest('2g', 20, [net('2g', 2412, 20)], undefined)?.channels, [6]);
  assert.deepEqual(quietest('2g', 20, [net('2g', 2412, 20), net('2g', 2437, 20)], undefined)?.channels, [11]);
});

test('no block of this width is free: the widest narrower one with empty blocks', () => {
  const allowed = new Set([36, 40, 44, 48]);
  const on36 = net('5g', 5180, 20);
  const r = emptyNarrower('5g', 80, [on36], allowed);
  assert.equal(r?.width, 40);
  assert.deepEqual(r.blocks, [[44, 48]]);
  assert.equal(emptyNarrower('5g', 80, [], allowed), undefined, 'one is free already');
  assert.equal(emptyNarrower('2g', 40, [net('2g', 2412, 20)], undefined), undefined);
  assert.equal(emptyNarrower('5g', 40, [net('5g', 5190, 40), net('5g', 5230, 40)], allowed), undefined, 'nothing empty at any width');
});

test('a network’s channels', () => {
  assert.deepEqual(coveredChannels({ band: '5g', center: 5210, width: 80 }), [36, 40, 44, 48]);
  assert.deepEqual(coveredChannels({ band: '5g', center: 5180, width: 20 }), [36]);
});
