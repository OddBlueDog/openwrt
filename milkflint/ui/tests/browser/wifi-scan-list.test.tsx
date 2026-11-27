// Nearby networks' list in a real browser: strongest first, the headings
// only turning round from there; by name with hidden networks last, by
// channel with the strongest first on each; a row is picked by a click or
// Enter and shared with the radar on hover; on a phone a Sort menu orders
// the cards, each a button.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import type { ScannedNetwork } from '@/features/wifi-scan/api';
import { NetworkList } from '@/features/wifi-scan/list';
import type { Blip } from '@/features/wifi-scan/radar';
import { renderWithProviders } from './render';

const net = (n: number, ssid: string | null, channel: number, signal: number | null): Blip => {
  const network: ScannedNetwork = {
    bssid: `aa:bb:cc:00:00:0${String(n)}`,
    ssid,
    mhz: 5000 + channel * 5,
    band: '5g',
    channel,
    width: 20,
    center: 5000 + channel * 5,
    signal,
    standard: 'ax',
    security: { privacy: true, rsn: { ciphers: ['ccmp'], akm: ['sae'], mfp: 'required' } },
    radio: 'phy1',
  };
  return { network, shares: channel === 36 };
};
// as the radar lays them out, in no order of their own
const blips = [
  net(1, 'Neighbour', 44, -70),
  net(2, null, 36, -50),
  net(3, 'Cafe', 36, -80),
  net(4, 'Attic', 44, -60),
  net(5, 'Far', 149, null),
];

afterEach(cleanup);

const names = (): string[] =>
  [...document.querySelectorAll('table[aria-label="Networks"] tbody tr')].map(
    (tr) => tr.querySelector('td span.truncate')?.textContent ?? '',
  );

function draw(
  width: number,
  on: { onFocus?: (b: string | undefined) => void; onSelect?: (b: string) => void; selected?: string } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <div style={{ width }}>
      <NetworkList
        stale={false}
        blips={blips}
        bands={['5g']}
        scanned
        focused={undefined}
        selected={on.selected}
        onFocus={on.onFocus ?? (() => undefined)}
        onSelect={on.onSelect ?? (() => undefined)}
      />
    </div>,
  );
}

test('strongest first; by name, hidden last; by channel, strongest first on each; headings only turn round', async () => {
  const screen = await draw(1000);
  const signal = screen.getByRole('columnheader', { name: 'Signal' });
  await expect.element(signal).toHaveAttribute('aria-sort', 'descending');
  expect(names()).toEqual(['Hidden network', 'Attic', 'Neighbour', 'Cafe', 'Far']);
  await signal.getByRole('button').click();
  expect(names()).toEqual(['Cafe', 'Neighbour', 'Attic', 'Hidden network', 'Far']);

  const name = screen.getByRole('columnheader', { name: 'Network' });
  await name.getByRole('button').click();
  expect(names()).toEqual(['Attic', 'Cafe', 'Far', 'Neighbour', 'Hidden network']);
  await name.getByRole('button').click();
  expect(names()).toEqual(['Neighbour', 'Far', 'Cafe', 'Attic', 'Hidden network']);
  await name.getByRole('button').click();
  await expect.element(name).toHaveAttribute('aria-sort', 'ascending');

  await screen.getByRole('columnheader', { name: 'Channel' }).getByRole('button').click();
  expect(names()).toEqual(['Hidden network', 'Cafe', 'Attic', 'Neighbour', 'Far']);
  expect(screen.getByRole('columnheader', { name: 'Security' }).getByRole('button').elements()).toHaveLength(0);
});

test('a row is picked by a click or Enter, and hovering one shows it on the radar', async () => {
  const onSelect = vi.fn();
  const onFocus = vi.fn();
  const screen = await draw(1000, { onSelect, onFocus, selected: 'aa:bb:cc:00:00:04' });
  await expect.element(screen.getByRole('row', { name: /Attic/ })).toHaveAttribute('aria-selected', 'true');
  await screen.getByRole('row', { name: /Cafe/ }).click();
  expect(onSelect).toHaveBeenLastCalledWith('aa:bb:cc:00:00:03');
  expect(onFocus).toHaveBeenCalledWith('aa:bb:cc:00:00:03');
  screen
    .getByRole('row', { name: /Neighbour/ })
    .element()
    .focus();
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith('aa:bb:cc:00:00:01');
});

test('on a phone: the Sort menu orders the cards, each a button that picks its network', async () => {
  const onSelect = vi.fn();
  const screen = await draw(380, { onSelect });
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  const sort = screen.getByRole('combobox', { name: 'Sort' });
  await expect.element(sort).toHaveTextContent('Strongest first');
  await sort.click();
  await screen.getByRole('option', { name: 'By name' }).click();
  const cards = (): string[] =>
    [...document.querySelectorAll('ul[aria-label="Networks"] li')].map(
      (li) => li.querySelector('span.truncate')?.textContent ?? '',
    );
  expect(cards()).toEqual(['Attic', 'Cafe', 'Far', 'Neighbour', 'Hidden network']);
  await screen.getByRole('list', { name: 'Networks' }).getByRole('button', { name: /^Cafe/ }).click();
  expect(onSelect).toHaveBeenCalledWith('aa:bb:cc:00:00:03');
});
