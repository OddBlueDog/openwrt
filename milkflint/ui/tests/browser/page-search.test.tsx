// The menu's search in a real browser: a tab or card is a result of its own
// ("Radar log", with its page beside it), and picking it, by click or Enter,
// opens that tab; the Logs page shows the log its address names, and a tab
// picked there goes in the address.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-react';
import { PageSearch } from '@/components/layout/page-search';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LogsPage } from '@/features/logs/page';
import type * as Ubus from '@/lib/ubus';

// no router here: every call fails as a method the router hasn't got; the search needs none,
// and the Logs page draws its tabs before any log has loaded
vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string): Promise<never> =>
      Promise.reject(new real.UbusError(object, method, real.UbusStatus.methodNotFound)),
  };
});

afterEach(async () => {
  await cleanup();
  window.location.hash = '';
});

async function drawSearch(): Promise<Awaited<ReturnType<typeof render>>> {
  window.location.hash = '#/dashboard';
  return render(
    <TooltipProvider>
      <PageSearch />
    </TooltipProvider>,
  );
}

test('radar finds the radar log and the radar scan, each with its page, and a click opens that tab', async () => {
  const screen = await drawSearch();
  await screen.getByRole('combobox', { name: 'Find a page' }).fill('radar');
  const log = screen.getByRole('option', { name: /^Radar log/ });
  const scan = screen.getByRole('option', { name: /^Radar scan/ });
  await expect.element(log).toHaveTextContent('Radar logLogs');
  await expect.element(scan).toHaveTextContent('Radar scanNearby networks');
  await expect.element(screen.getByRole('option', { name: /^Nearby networks/ })).toBeVisible();

  // moving the pointer over a result picks it
  await userEvent.hover(scan);
  await expect.element(scan).toHaveAttribute('aria-selected', 'true');
  await expect.element(log).toHaveAttribute('aria-selected', 'false');

  await log.click();
  await expect.poll(() => window.location.hash).toBe('#/logs/radar');
  // the box empties and the list closes
  await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
});

test('Enter opens the best match; the arrows pick another', async () => {
  const screen = await drawSearch();
  const box = screen.getByRole('combobox', { name: 'Find a page' });
  await box.fill('zones');
  await expect.element(screen.getByRole('option', { name: /^Zones/ })).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => window.location.hash).toBe('#/firewall/zones');

  // the pointer rests where the last test clicked, over the list: it doesn't take the pick back from the arrows
  await box.fill('radar');
  await expect.element(screen.getByRole('option', { name: /^Radar log/ })).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(screen.getByRole('option', { name: /^Radar scan/ })).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => window.location.hash).toBe('#/wifi-scan/radar');
});

test('wifi and wi-fi find the Wi-Fi pages', async () => {
  const screen = await drawSearch();
  const box = screen.getByRole('combobox', { name: 'Find a page' });
  for (const q of ['wifi', 'wi-fi']) {
    await box.fill(q);
    await expect.element(screen.getByRole('option', { name: /^Guest Wi-Fi/ })).toBeVisible();
    await expect.element(screen.getByRole('option', { name: /^Networks & radios/ })).toBeVisible();
    await expect.element(screen.getByRole('option', { name: /^Wi-Fi log/ })).toBeVisible();
  }
});

test('the Logs page opens on the log in its address, and a tab picked goes in the address', async () => {
  window.location.hash = '#/logs/radar';
  const screen = await render(
    <TooltipProvider>
      <LogsPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('tab', { name: 'Radar' })).toHaveAttribute('aria-selected', 'true');
  await expect.element(screen.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'false');

  await screen.getByRole('tab', { name: 'Crashes' }).click();
  await expect.poll(() => window.location.hash).toBe('#/logs/crash');
  await expect.element(screen.getByRole('tab', { name: 'Crashes' })).toHaveAttribute('aria-selected', 'true');

  // the first log is the page's own address
  await screen.getByRole('tab', { name: 'System' }).click();
  await expect.poll(() => window.location.hash).toBe('#/logs');

  // the search going to another log while the page is open
  window.location.hash = '#/logs/kernel';
  await expect.element(screen.getByRole('tab', { name: 'Kernel' })).toHaveAttribute('aria-selected', 'true');
  // an address naming no log: the first
  window.location.hash = '#/logs/nothing';
  await expect.element(screen.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true');
});
