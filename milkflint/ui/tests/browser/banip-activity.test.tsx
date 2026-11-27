// banIP's Activity tab in a real browser, against a pretend banIP with two
// blocked connections recorded and three lists reported: the blocked
// connections stay newest first (a page of the router's, so nothing sorts)
// with each row's actions; each list sorts by name, entries and hits each
// way, a list that doesn't count that way last, and a third click goes back
// to the lists first, your own last.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import type { BanipConfig } from '@/features/banip/api';
import { ActivityTab } from '@/features/banip/activity';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const drop = (t: number, dir: string, src: string, dst: string, dport: string, set: string): unknown => ({
  t,
  dir,
  kind: '',
  policy: 'drop',
  set,
  in: dir === 'out' ? 'br-lan' : 'wan',
  out: dir === 'out' ? 'wan' : '',
  src,
  dst,
  proto: 'tcp',
  sport: '40000',
  dport,
  mac: '',
});
const set = (elements: number, inbound: number | null, outbound: number | null): unknown => ({
  elements,
  inbound: inbound !== null,
  outbound: outbound !== null,
  in_packets: inbound,
  out_packets: outbound,
  ports: null,
  top: [],
});

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const raw =
        `${object} ${method}` === 'milkflint.banip drops'
          ? {
              total: 2,
              offset: 0,
              rows: [
                drop(1_794_929_000, 'out', '192.168.1.20', '203.0.113.9', '443', 'doh.v4'),
                drop(1_794_928_000, 'in', '198.51.100.7', '203.0.113.1', '22', 'firehol1.v4'),
              ],
              top: { sources: [], devices: [], ports: [], sets: [], directions: {} },
              first: 1_794_920_000,
              events: [],
            }
          : `${object} ${method}` === 'milkflint.banip report'
            ? {
                generated: 1_794_929_000,
                counting: true,
                sets: {
                  'allowlist.v4': set(2, 0, 0),
                  'firehol1.v4': set(1000, 5, null),
                  'doh.v4': set(50, null, 12),
                },
              }
            : answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(cleanup);

const config = { installed: true, enabled: true, options: {} } as unknown as BanipConfig;
const lists = (): string[] =>
  [...document.querySelectorAll('table[aria-label="Each list"] tbody tr')].map((tr) => tr.querySelector('td')?.textContent ?? '');

async function draw(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  const screen = await renderWithProviders(
    <div style={{ width: 1100 }}>
      <ActivityTab c={config} s={undefined} onSaved={() => undefined} />
    </div>,
  );
  await expect.element(screen.getByRole('table', { name: 'Blocked connections' })).toBeVisible();
  await expect.element(screen.getByRole('table', { name: 'Each list' })).toBeVisible();
  return screen;
}

test('blocked connections: newest first, each with its actions, and no heading sorts', async () => {
  const screen = await draw();
  const table = screen.getByRole('table', { name: 'Blocked connections' });
  const addresses = [...table.element().querySelectorAll('tbody tr')].map((tr) => tr.children[2]?.textContent);
  expect(addresses).toEqual(['203.0.113.9', '198.51.100.7']);
  // the device, by its name from the router's hints
  await expect.element(table.getByRole('cell', { name: 'studio-mac' })).toBeVisible();
  await expect.element(table.getByRole('button', { name: 'Always allow 203.0.113.9' })).toBeVisible();
  expect(table.getByRole('columnheader').getByRole('button').elements()).toHaveLength(0);
});

test('each list sorts, a list that doesn’t count that way last; a third click is the lists first again', async () => {
  const screen = await draw();
  expect(lists()).toEqual(['doh.v4', 'firehol1.v4', 'allowlist.v4']);
  const coming = screen.getByRole('columnheader', { name: 'Coming in' });
  await coming.getByRole('button').click();
  await expect.element(coming).toHaveAttribute('aria-sort', 'descending');
  expect(lists()).toEqual(['firehol1.v4', 'allowlist.v4', 'doh.v4']);
  await coming.getByRole('button').click();
  expect(lists()).toEqual(['allowlist.v4', 'firehol1.v4', 'doh.v4']);
  await coming.getByRole('button').click();
  expect(lists()).toEqual(['doh.v4', 'firehol1.v4', 'allowlist.v4']);
  await screen.getByRole('columnheader', { name: 'Entries' }).getByRole('button').click();
  expect(lists()).toEqual(['firehol1.v4', 'doh.v4', 'allowlist.v4']);
  await screen.getByRole('columnheader', { name: 'List' }).getByRole('button').click();
  expect(lists()).toEqual(['allowlist.v4', 'doh.v4', 'firehol1.v4']);
  expect(screen.getByRole('columnheader', { name: 'Ports' }).getByRole('button').elements()).toHaveLength(0);
});
