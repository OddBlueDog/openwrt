// The Updates card AdGuard Home and banIP share: what's installed (apk's
// version as it is), what the feed has tested with this release, Check,
// Update and Go back with what it does to the settings, waiting for another
// install, plain reasons when one fails; and banIP's license card linking the
// installed build's source: OpenWrt's package at the commit it names.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { PackageUpdatesCard } from '@/components/package-updates';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LicenseCard } from '@/features/banip/license-card';
import type * as Api from '@/lib/api/packages';
import { renderWithProviders } from './render';

const router = vi.hoisted(() => ({
  status: {},
  calls: [] as string[],
}));

vi.mock('@/lib/api/packages', async (importOriginal) => {
  const real = await importOriginal<typeof Api>();
  return {
    ...real,
    getPackageStatus: () => Promise.resolve(real.updateSchema.parse(router.status)),
    checkPackage: (name: string) => {
      router.calls.push(`check ${name}`);
      return Promise.resolve();
    },
    installPackage: (name: string, version: string) => {
      router.calls.push(`install ${name} ${version}`);
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  router.calls = [];
  router.status = {
    busy: false,
    installed: '1.9.1-r1005',
    latest: '1.9.2-r1006',
    versions: ['1.9.2-r1006', '1.9.1-r1005', '1.9.0-r1003'],
    checked: 1_790_000_000,
  };
});
afterEach(cleanup);

function card(
  name: 'banip' | 'adguardhome',
  notes: string,
  more: { installing?: string; backNote?: string } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <TooltipProvider>
      <PackageUpdatesCard name={name} title="Updates" notes={notes} {...more} />
    </TooltipProvider>,
  );
}

test('banIP: the installed version, a newer tested one to install, and the copy', async () => {
  const screen = await card('banip', 'New banIP versions reach this card after MilkFlint has tested them with this page.');
  await expect
    .element(screen.getByText('New banIP versions reach this card after MilkFlint has tested them with this page.'))
    .toBeVisible();
  await expect.element(screen.getByText('1.9.1-r1005')).toBeVisible();
  await screen.getByRole('button', { name: 'Update to 1.9.2-r1006' }).click();
  await vi.waitFor(() => {
    expect(router.calls).toEqual(['install banip ']);
  });
});

test('Check asks the router to look, for this package only', async () => {
  const screen = await card('adguardhome', 'From MilkFlint’s package feed.');
  await screen.getByRole('button', { name: 'Check' }).click();
  await vi.waitFor(() => {
    expect(router.calls).toEqual(['check adguardhome']);
  });
});

test('going back says what it does to the settings', async () => {
  const screen = await card('banip', 'New banIP versions.', { backNote: 'Your settings stay as they are.' });
  await expect.element(screen.getByText('Your settings stay as they are.')).toBeVisible();
});

test('a check that found nothing tested for this release says so', async () => {
  router.status = {
    busy: false,
    action: 'check',
    ok: true,
    installed: '1.9.1-r1005',
    latest: null,
    versions: [],
    checked: 1_790_000_000,
  };
  const screen = await card('banip', 'New banIP versions.');
  await expect.element(screen.getByText('no tested update for this release yet')).toBeVisible();
});

test('an install waiting for another one says so', async () => {
  router.status = { busy: true, waiting: true, action: 'install', installed: '1.9.1-r1005', checked: 1_790_000_000 };
  const waiting = await card('banip', 'New banIP versions.');
  await expect.element(waiting.getByText('Waiting for another update to finish.')).toBeVisible();
});

test('AdGuard Home’s install says what DNS does meanwhile', async () => {
  router.status = { busy: true, waiting: false, action: 'install', installed: '1.0.0-r1001', checked: 1_790_000_000 };
  const agh = await card('adguardhome', 'From MilkFlint’s package feed.', {
    installing: 'the router answers DNS itself meanwhile',
  });
  await expect.element(agh.getByText('Installing AdGuard Home; the router answers DNS itself meanwhile.')).toBeVisible();
});

test('a failed install gives a plain reason, not apk’s lines, and says the version before is back on', async () => {
  router.status = {
    busy: false,
    action: 'install',
    ok: false,
    error: 'after',
    back_on: true,
    installed: '1.9.1-r1005',
    log: 'ERROR: banip-1.9.1-r1006: some apk line',
    checked: 1_790_000_000,
  };
  const screen = await card('banip', 'New banIP versions.');
  await expect.element(screen.getByText('banIP didn’t work with that version, so 1.9.1-r1005 is back on.')).toBeVisible();
  expect(screen.container.textContent).not.toContain('ERROR');
});

test('banIP’s license card: where it comes from, the build number read from the version, and one source link at the build’s commit', async () => {
  const source = 'https://github.com/openwrt/packages/tree/ccb56eff0a2e/net/banip';
  const screen = await renderWithProviders(<LicenseCard s={{ installed: true, version: '1.9.2-r1001', source }} />);
  await expect.element(screen.getByText(/r1001 here is upstream’s r1/)).toBeVisible();
  await expect.element(screen.getByText(/MilkFlint’s own package feed/)).toBeVisible();
  await expect.element(screen.getByRole('link', { name: 'Source code (banIP 1.9.2-r1001)' })).toHaveAttribute('href', source);
  // one link to the source: OpenWrt's package, at that commit
  expect(screen.container.querySelectorAll('a[href*="github.com/openwrt/packages"]')).toHaveLength(1);
});

test('banIP’s license card: a build that names no source links the package’s history on OpenWrt 25.12', async () => {
  const screen = await renderWithProviders(<LicenseCard s={{ installed: true, version: '1.9.1-r1005' }} />);
  await expect
    .element(screen.getByRole('link', { name: 'Source code (banIP 1.9.1-r1005)' }))
    .toHaveAttribute('href', 'https://github.com/openwrt/packages/commits/openwrt-25.12/net/banip');
});
