// The radar scan's plan: the 5 GHz radar channels as blocks to listen on,
// what each block's channels are doing now, and whether a scan may start.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockLabel, blocksOf, channelState, minutes, radarSummary, scanPlan } from '../src/features/radar-scan/model.ts';
import type { Radar } from '../src/lib/api/wireless.ts';

const channel = (c: number, state = 'usable', for_s: number | null = null): Radar['channels'][number] => ({
  mhz: 5000 + 5 * c,
  channel: c,
  state,
  for_s,
});
const radar = (channels: Radar['channels']): Radar => ({ events: [], channels });

// GB: 52–64 and 100–140 are radar channels (144 isn't allowed)
const gb = radar([52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140].map((c) => channel(c)));

test('radar channels as blocks: 80 MHz where all four are, else 40, else 20', () => {
  const blocks = blocksOf(gb);
  assert.deepEqual(
    blocks.map((b) => [b.key, b.width]),
    [
      ['52-56-60-64', 80],
      ['100-104-108-112', 80],
      ['116-120-124-128', 80],
      ['132-136', 40],
      ['140', 20],
    ],
  );
  const first = blocks[0];
  assert.deepEqual(first === undefined ? undefined : [first.freq, first.center], [5260, 5290]);
  assert.equal(first === undefined ? '' : blockLabel(first), 'Channels 52–64 (80 MHz)');
  assert.deepEqual(blocksOf(undefined), []);
});

test('a block’s channels now: off limits after radar with the minutes left, checked, or not yet', () => {
  const r = radar([
    channel(100, 'unavailable', 400),
    channel(104, 'unavailable', 1700),
    channel(52, 'available', 50),
    channel(56, 'available', 50),
    channel(116),
  ]);
  assert.deepEqual(channelState(r, [100, 104]), { kind: 'off-limits', minutesLeft: 24 });
  assert.deepEqual(channelState(radar([channel(100, 'unavailable', 1799)]), [100]), { kind: 'off-limits', minutesLeft: 1 });
  assert.deepEqual(channelState(r, [52, 56]), { kind: 'checked' });
  assert.deepEqual(channelState(r, [116]), { kind: 'unchecked' });
  assert.deepEqual(channelState(undefined, [116]), { kind: 'unchecked' });
});

test('the radar channels in a line', () => {
  const r = radar([
    ...gb.channels.filter((c) => ![52, 56, 60, 64, 100].includes(c.channel)),
    ...[52, 56, 60, 64].map((c) => channel(c, 'available', 10)),
    channel(100, 'unavailable', 0),
  ]);
  assert.equal(
    radarSummary(r, blocksOf(gb)),
    '5 blocks: 1 checked with no radar heard, 1 off limits after radar and 3 not checked yet.',
  );
  assert.equal(radarSummary(gb, []), 'This radio has no radar channels in this country.');
});

test('whether a scan may start, and what it costs', () => {
  assert.deepEqual(scanPlan(0, 60), { ok: false, text: 'Pick at least one block.', total: 0 });
  assert.equal(scanPlan(2, 5).text, 'Choose between 10 and 3600 seconds.');
  assert.equal(scanPlan(2, Number.NaN).ok, false);
  assert.equal(scanPlan(3, 3600).text, 'At most two hours in all: pick fewer blocks or a shorter time.');
  assert.deepEqual(scanPlan(3, 60), { ok: true, text: 'The 5 GHz network will be off for about 3 minutes.', total: 180 });
  assert.equal(scanPlan(1, 60).text, 'The 5 GHz network will be off for about 60 seconds.');
  assert.equal(minutes(89), '89 seconds');
  assert.equal(minutes(95), '2 minutes');
});
