// LAN & DHCP in a real browser, against the pretend router's busy household:
// three path-addressed tabs, the lease tables (cards at phone width), the
// SLAAC line, and Settings back at #/lan with today's form.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LanPage } from '@/features/lan/page';
import type * as Ubus from '@/lib/ubus';
import { dhcpv6Setting } from './router';
import { renderWithProviders } from './render';

const sent = vi.hoisted(() => [] as { object: string; params: Record<string, unknown> }[]);
const drained = vi.hoisted(() => ({ on: false }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      sent.push({ object, params });
      const { answer } = await import('./router');
      let raw = answer('busy', object, method, params);
      if (drained.on && object === 'milkflint.connections' && raw !== undefined) {
        // the Mac's connections have ended: no device or row of its is left
        const r = raw as { devices: { addr: string }[]; rows: { owner: string }[] };
        const gone = (a: string): boolean =>
          a.startsWith('192.168.1.20') || a.startsWith('2001:db8:1:1::') || a.startsWith('fd00:1::2');
        raw = { ...r, devices: r.devices.filter((d) => !gone(d.addr)), rows: r.rows.filter((c) => !gone(c.owner)) };
      }
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  sent.length = 0;
  drained.on = false;
  dhcpv6Setting.value = 'server';
  await cleanup();
  await page.viewport(1400, 1000);
});

async function draw(hash: string): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = hash;
  return renderWithProviders(
    <TooltipProvider>
      <LanPage />
    </TooltipProvider>,
  );
}

test('Addresses opens from its path with three tabs and both lease tables', async () => {
  const screen = await draw('#/lan/addresses');
  await expect.element(screen.getByRole('heading', { name: 'LAN & DHCP', level: 1 })).toBeVisible();
  await expect.element(screen.getByRole('tab', { name: 'Addresses' })).toHaveAttribute('aria-selected', 'true');
  await expect.element(screen.getByRole('tab', { name: 'Settings' })).toBeVisible();
  await expect.element(screen.getByRole('tab', { name: 'Connections' })).toBeVisible();
  await expect.element(screen.getByRole('table', { name: 'IPv4 leases' })).toBeVisible();
  await expect.element(screen.getByRole('table', { name: 'IPv6 addresses' })).toBeVisible();
  await expect.element(screen.getByRole('table', { name: 'IPv4 leases' }).getByText('192.168.1.20')).toBeVisible();
  await expect.element(screen.getByRole('table', { name: 'IPv6 addresses' }).getByText('Never ends')).toBeVisible();
  await expect.element(screen.getByText(/SLAAC addresses are the ones the router has seen in use lately/)).toBeVisible();
  // the Mac's address it picked itself, beside its leased one
  await expect
    .element(screen.getByRole('table', { name: 'IPv6 addresses' }).getByText(/^2001:db8:1:1::20/))
    .toHaveTextContent('2001:db8:1:1::20SLAAC');
  expect(document.body.textContent).not.toContain('All devices shows');
  // a lease with no name at all, drawn as on every device list
  await expect.element(screen.getByRole('table', { name: 'IPv6 addresses' }).getByText('Unnamed device')).toBeVisible();
});

test('DHCPv6 unset is off: the note names IPv6 and links to it', async () => {
  dhcpv6Setting.value = undefined;
  const screen = await draw('#/lan/addresses');
  await expect.element(screen.getByText(/The DHCPv6 server is off/)).toBeVisible();
  // hash history writes the page's own path before the "#"
  await expect.element(screen.getByRole('link', { name: 'IPv6' })).toHaveAttribute('href', expect.stringMatching(/#\/ipv6$/));
});

test('DHCPv6 relayed says the main router keeps the leases', async () => {
  dhcpv6Setting.value = 'relay';
  const screen = await draw('#/lan/addresses');
  await expect.element(screen.getByText('DHCPv6 is relayed to your main router, which keeps these leases.')).toBeVisible();
  expect(document.body.textContent).not.toContain('The DHCPv6 server is off');
});

test('DHCPv6 on shows neither note', async () => {
  const screen = await draw('#/lan/addresses');
  await expect.element(screen.getByRole('table', { name: 'IPv6 addresses' })).toBeVisible();
  expect(document.body.textContent).not.toContain('The DHCPv6 server is off');
  expect(document.body.textContent).not.toContain('relayed to your main router');
});

test('at phone width the tables are card lists', async () => {
  await page.viewport(360, 800);
  const screen = await draw('#/lan/addresses');
  await expect.element(screen.getByRole('list', { name: 'IPv4 leases' })).toBeVisible();
  await expect.element(screen.getByRole('list', { name: 'IPv6 addresses' })).toBeVisible();
});

test('Settings goes back to #/lan and shows the form', async () => {
  const screen = await draw('#/lan/addresses');
  await screen.getByRole('tab', { name: 'Settings' }).click();
  expect(window.location.hash).toBe('#/lan');
  await expect.element(screen.getByText('Address and DHCP')).toBeVisible();
});

test('connections: one device per MAC, and filtered', async () => {
  const screen = await draw('#/lan/connections');
  await expect.element(screen.getByRole('table', { name: 'Connections' })).toBeVisible();
  await screen.getByRole('combobox', { name: 'Device' }).click();
  await expect.element(screen.getByRole('option', { name: /^studio-mac/ })).toBeVisible();
  expect(screen.getByRole('option', { name: /^studio-mac/ }).elements()).toHaveLength(1);
  await screen.getByRole('option', { name: /^studio-mac/ }).click();
  await vi.waitFor(() => {
    const asked = sent
      .filter((c) => c.object === 'milkflint.connections')
      .map((c) => c.params['addrs'] as string[] | undefined)
      .find((a) => a !== undefined);
    expect(asked?.toSorted()).toEqual(['192.168.1.20', '2001:db8:1:1::20', 'fd00:1::20']);
  });
  await vi.waitFor(() => {
    expect(screen.getByRole('table', { name: 'Connections' }).getByRole('row').elements()).toHaveLength(4); // the heading and the Mac's three
  });
});

/** The Remote cell of each row of the wide table, top to bottom. */
function remotes(screen: Awaited<ReturnType<typeof renderWithProviders>>): string[] {
  const table = screen.getByRole('table', { name: 'Connections' }).element() as HTMLTableElement;
  return [...(table.tBodies[0]?.rows ?? [])].map((r) => r.cells[3]?.textContent ?? '');
}

test('connections: the search filters at once, and asks the router for the same words, a name with its device’s addresses', async () => {
  const screen = await draw('#/lan/connections');
  await expect.element(screen.getByRole('table', { name: 'Connections' })).toBeVisible();
  await screen.getByRole('searchbox', { name: 'Search connections' }).fill('Studio 443');
  await vi.waitFor(() => {
    expect(remotes(screen)).toEqual(['142.250.180.14:443', '[2a00:1450:4009:820::200e]:443']);
  });
  await expect.element(screen.getByText('2 connections match.')).toBeVisible();
  await vi.waitFor(() => {
    const asked = sent
      .filter((c) => c.object === 'milkflint.connections')
      .map((c) => c.params['search'] as { text: string; owners?: string[] }[] | undefined)
      .find((w) => w !== undefined);
    expect(asked?.map((w) => ({ ...w, owners: w.owners?.toSorted() }))).toEqual([
      { text: 'studio', owners: ['192.168.1.20', '2001:db8:1:1::20', 'fd00:1::20'] },
      { text: '443', owners: undefined },
    ]);
  });
  await screen.getByRole('searchbox', { name: 'Search connections' }).fill('nothing-like-this');
  await expect.element(screen.getByText('No connections match the search.')).toBeVisible();
});

test('connections: a heading sorts, a second click turns the order round, a third goes back to busiest first', async () => {
  const screen = await draw('#/lan/connections');
  await vi.waitFor(() => {
    expect(remotes(screen)).toHaveLength(7);
  });
  const busiest = remotes(screen);
  expect(busiest[3]).toBe('9.9.9.9:853');
  const sentHead = screen.getByRole('columnheader', { name: 'Sent' });
  await sentHead.getByRole('button').click();
  await expect.element(sentHead).toHaveAttribute('aria-sort', 'descending');
  expect(remotes(screen)[3]).toBe('203.0.113.9:40000');
  await sentHead.getByRole('button').click();
  await expect.element(sentHead).toHaveAttribute('aria-sort', 'ascending');
  expect(remotes(screen)[0]).toBe('203.0.113.9:51820');
  await sentHead.getByRole('button').click();
  await expect.element(sentHead).not.toHaveAttribute('aria-sort');
  expect(remotes(screen)).toEqual(busiest);
  const deviceHead = screen.getByRole('columnheader', { name: 'Device' });
  await deviceHead.getByRole('button').click();
  await expect.element(deviceHead).toHaveAttribute('aria-sort', 'ascending');
});

test('connections: at phone width the Sort menu orders the cards', async () => {
  await page.viewport(390, 900);
  const screen = await draw('#/lan/connections');
  await expect.element(screen.getByRole('list', { name: 'Connections' })).toBeVisible();
  const cards = screen.getByRole('list', { name: 'Connections' }).getByRole('listitem');
  const remoteOf = (i: number): string => /Remote:(.+?)Sent:/.exec(cards.nth(i).element().textContent)?.[1] ?? '';
  await vi.waitFor(() => {
    expect(remoteOf(3)).toBe('9.9.9.9:853');
  });
  await screen.getByRole('combobox', { name: 'Sort' }).click();
  await screen.getByRole('option', { name: 'Most sent first' }).click();
  await vi.waitFor(() => {
    expect(remoteOf(3)).toBe('203.0.113.9:40000');
  });
  await screen.getByRole('button', { name: 'Reverse the order' }).click();
  await vi.waitFor(() => {
    expect(remoteOf(0)).toBe('203.0.113.9:51820');
  });
  await expect.element(screen.getByRole('button', { name: 'Reverse the order' })).toHaveAttribute('aria-pressed', 'true');
});

test('connections: the graph draws TCP, UDP and other from the tab’s own reads', async () => {
  const screen = await draw('#/lan/connections');
  await expect.element(screen.getByRole('img', { name: 'TCP, UDP and other connections while this tab is open' })).toBeVisible();
  await expect.element(screen.getByText(/Recorded while this tab is open/)).toBeVisible();
});

test('connections stop when the tab is left', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const count = (): number => sent.filter((c) => c.object === 'milkflint.connections').length;
    const screen = await draw('#/lan/connections');
    await vi.waitFor(() => {
      expect(count()).toBeGreaterThan(0);
    });
    const first = count();
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      expect(count()).toBeGreaterThan(first);
    });
    await screen.getByRole('tab', { name: 'Addresses' }).click();
    await vi.advanceTimersByTimeAsync(1000);
    const left = count();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(count()).toBe(left);
  } finally {
    vi.useRealTimers();
  }
});

test('a device that drains out of the list keeps its addresses and stays chosen', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const screen = await draw('#/lan/connections');
    await screen.getByRole('combobox', { name: 'Device' }).click();
    await screen.getByRole('option', { name: /^studio-mac/ }).click();
    await vi.waitFor(() => {
      expect(sent.some((c) => Array.isArray(c.params['addrs']) && (c.params['addrs'] as string[]).length === 3)).toBe(true);
    });
    drained.on = true;
    const before = sent.length;
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      expect(sent.length).toBeGreaterThan(before + 1);
    });
    const later = sent
      .slice(before)
      .filter((c) => c.object === 'milkflint.connections')
      .map((c) => c.params['addrs'] as string[] | undefined);
    expect(later.length).toBeGreaterThan(0);
    for (const a of later) expect(a?.toSorted()).toEqual(['192.168.1.20', '2001:db8:1:1::20', 'fd00:1::20']);
    await expect.element(screen.getByRole('combobox', { name: 'Device' })).toHaveTextContent('studio-mac · 0');
  } finally {
    vi.useRealTimers();
  }
});
