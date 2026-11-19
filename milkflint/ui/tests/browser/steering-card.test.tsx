// Performance Tuning's packet steering card in a real browser: what
// Automatic uses on a PPPoE line and on another one, and the warning when
// RSS is chosen on a PPPoE line, whose packets RSS can't spread.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SteeringCard } from '@/features/tuning/essentials';
import { defaults, type Steering, type TuningData } from '@/features/tuning/model';
import type { NetworkLive } from '@/hooks/use-network-live';

afterEach(async () => {
  await cleanup();
});

// a router with the four rings, RSS spreading (as the GL-MT6000 has it)
const live: NetworkLive = {
  cpus: [],
  rss: { table: [0, 43, 43, 42], hash: 'toeplitz', spreading: true },
  rings: [],
  send: undefined,
  wifi: { irqs: [], cpus: [], load: undefined, threads: 0 },
  rps: [],
  threads: [],
  queues: [],
  qdiscs: [],
  rates: new Map(),
};

function data(steering: Steering, pppoe: boolean): TuningData {
  return {
    form: { ...defaults, steering },
    milkflint: [],
    globals: 'globals',
    packetSteering: undefined,
    firewall: undefined,
    sqm: undefined,
    wed: { milkflint: [], sqm: [], firewall: [] },
    accessPoint: false,
    pppoe,
  };
}

async function card(steering: Steering, pppoe: boolean): Promise<Awaited<ReturnType<typeof render>>> {
  return render(
    <TooltipProvider>
      <SteeringCard form={{ ...defaults, steering }} data={data(steering, pppoe)} live={live} set={() => undefined} />
    </TooltipProvider>,
  );
}

test('Automatic on a PPPoE line uses RPS, and says why', async () => {
  const screen = await card('auto', true);
  await expect.element(screen.getByText('Automatic (default)')).toBeVisible();
  await expect.element(screen.getByText('RPS, as your internet connection is PPPoE, which RSS can’t spread')).toBeVisible();
});

test('Automatic on another line uses RSS', async () => {
  const screen = await card('auto', false);
  await expect.element(screen.getByText('RSS', { exact: true })).toBeVisible();
});

test('RSS chosen on a PPPoE line: a warning that it spreads nothing, and what Automatic does', async () => {
  const screen = await card('rss', true);
  await expect.element(screen.getByText(/Your internet connection is PPPoE, which RSS can’t spread/)).toBeVisible();
  expect(screen.getByText('Automatic uses').query()).toBeNull();
});

test('RSS chosen on another line, or RPS on PPPoE: no warning', async () => {
  for (const [steering, pppoe] of [
    ['rss', false],
    ['rps', true],
  ] as const) {
    const screen = await card(steering, pppoe);
    expect(screen.getByText(/which RSS can’t spread/).query()).toBeNull();
    await cleanup();
  }
});
