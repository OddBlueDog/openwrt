// Two of Home's widgets in a real browser, on the pretend router's busy
// household. Busiest devices: All, Wi-Fi or LAN, the wired devices from the
// connections through the router (studio-mac, and two addresses with no
// name), the Wi-Fi-only columns gone for LAN, the choice kept in this
// browser. Ethernet ports: a port's details on focus (as on hover), with why
// a slow link is slow.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { busyFilter } from '@/features/dashboard/busy';
import { HomeGrid } from '@/features/dashboard/home-grid';
import type * as Ubus from '@/lib/ubus';
import { dashboard, live } from './fixtures';
import { renderWithProviders } from './render';

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

afterEach(async () => {
  busyFilter.save(undefined);
  await cleanup();
});

async function draw(
  id: 'busiest-devices' | 'ports',
  d = dashboard('busy'),
): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  return renderWithProviders(
    <TooltipProvider>
      <div style={{ width: '56rem' }}>
        <HomeGrid layout={[{ key: id, id, size: { w: 4, h: 2 } }]} data={{ d, live: live('busy'), ap: false }} />
      </div>
    </TooltipProvider>,
  );
}

const table = (): HTMLTableElement | null => document.querySelector('table[aria-label="Busiest devices"]');
const text = (): string => table()?.textContent ?? '';

test('Busiest devices: All, then LAN (from the connections, no Wi-Fi columns), then Wi-Fi; the choice kept', async () => {
  const screen = await draw('busiest-devices');
  await expect.element(screen.getByRole('heading', { name: 'Busiest devices' })).toBeVisible();
  // All: the Wi-Fi devices, busiest first (a wired one has no rate until its second sample, so comes last)
  await vi.waitFor(() => {
    expect(text()).toContain('kitchen-echo-show-8');
  });

  await screen.getByRole('radio', { name: 'LAN' }).click();
  await vi.waitFor(() => {
    expect(text()).toContain('studio-mac');
  });
  expect(text()).toContain('192.168.1.31');
  expect(text()).not.toContain('kitchen-echo-show-8');
  expect(screen.getByRole('columnheader', { name: 'Signal' }).query()).toBeNull();
  expect(busyFilter.get()).toBe('lan');

  await screen.getByRole('radio', { name: 'Wi-Fi' }).click();
  await vi.waitFor(() => {
    expect(text()).not.toContain('studio-mac');
  });
  expect(text()).toContain('kitchen-echo-show-8');
  expect(localStorage.getItem('milkflint.home.busiest')).toBe('"wifi"');
});

test('Ethernet ports: a port’s details on focus, with why its link is slow', async () => {
  const d = dashboard('busy');
  d.ports = d.ports.map((p) =>
    p.device === 'lan1'
      ? { ...p, link: true, mbit: 100, partnerMbit: 100, mac: '94:83:c4:00:00:11', totalDown: 2_000_000, totalUp: 500, errors: 3 }
      : p,
  );
  const screen = await draw('ports', d);
  const port = screen.getByRole('button', { name: /^LAN 1: Connected at 100 Mbit\/s/ });
  (port.element() as HTMLElement).focus();
  // Radix keeps the tooltip's words for screen readers in an element of role tooltip
  const tip = (): string => document.querySelector('[role="tooltip"]')?.textContent ?? '';
  await vi.waitFor(() => {
    expect(tip()).toMatch(/the device at the other end goes up to 100 Mbit\/s/);
  });
  expect(tip()).toMatch(/Port’s fastest\s*1 Gbit\/s/);
  expect(tip()).toMatch(/94:83:c4:00:00:11/);
  expect(tip()).toMatch(/Errors\s*3 frames/);
});
