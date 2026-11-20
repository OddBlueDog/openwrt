// banIP's switch at the top of the page and the Protection tab's preset
// cards: a card picked while banIP is off and not saved yet is what the
// switch turns on, rather than Recommended (a user's report: Strict picked,
// switch on, and the page went back to Recommended).
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type * as Api from '@/features/banip/api';
import { PRESETS } from '@/features/banip/feeds';
import { BanipPage } from '@/features/banip/page';

/** The pretend router's banIP: off, with no list chosen yet, as a fresh install has it. */
interface PretendBanip {
  enabled: boolean;
  options: Partial<Record<string, string | string[] | null>>;
  milkflint: Partial<Record<string, string>>;
  saves: Record<string, unknown>[];
}
const router: PretendBanip = vi.hoisted(() => ({ enabled: false, options: {}, milkflint: {}, saves: [] }));

vi.mock('@/features/banip/api', async (importOriginal) => {
  const real = await importOriginal<typeof Api>();
  const ok = { ok: true } as unknown as Api.Result;
  return {
    ...real,
    getStatus: () =>
      Promise.resolve({
        installed: true,
        enabled: router.enabled,
        mode: 'router',
        state: router.enabled ? 'protecting' : 'off',
      } as unknown as Api.BanipStatus),
    getConfig: () =>
      Promise.resolve({
        installed: true,
        mode: 'router',
        enabled: router.enabled,
        options: { ...router.options },
        milkflint: { ...router.milkflint },
      } as unknown as Api.BanipConfig),
    saveOptions: (options: Record<string, string | string[] | null>, milkflint: Record<string, string> = {}) => {
      router.saves.push({ options, milkflint });
      Object.assign(router.options, options);
      Object.assign(router.milkflint, milkflint);
      return Promise.resolve(ok);
    },
    enableBanip: (on: boolean) => {
      router.enabled = on;
      return Promise.resolve(ok);
    },
  };
});

beforeEach(() => {
  router.enabled = false;
  router.options = {};
  router.milkflint = {};
  router.saves = [];
});

afterEach(async () => {
  await cleanup();
});

const feedsOf = (id: string): readonly string[] => PRESETS.find((p) => p.id === id)?.feeds ?? [];
const savedFeeds = (): string[] => {
  const v = router.options['ban_feed'];
  return (Array.isArray(v) ? [...v] : []).sort();
};

async function drawPage(): Promise<Awaited<ReturnType<typeof render>>> {
  window.location.hash = '#/banip';
  const screen = await render(
    <TooltipProvider>
      <BanipPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('switch', { name: 'Turn banIP on' })).toBeVisible();
  return screen;
}

test('Strict picked while off, then the switch: banIP starts with the Strict lists', async () => {
  const screen = await drawPage();
  await screen.getByRole('radio', { name: /^Strict/ }).click();
  await screen.getByRole('switch', { name: 'Turn banIP on' }).click();
  await expect.element(screen.getByRole('switch', { name: 'Turn banIP off' })).toBeVisible();
  expect(router.enabled).toBe(true);
  expect(savedFeeds()).toEqual([...feedsOf('strict')].sort());
  expect(router.milkflint['preset']).toBe('strict');
  await expect.element(screen.getByRole('radio', { name: /^Strict/ })).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByText(/with the Strict lists/)).toBeVisible();
});

test('nothing picked, nothing chosen yet: the switch still starts Recommended', async () => {
  const screen = await drawPage();
  await screen.getByRole('switch', { name: 'Turn banIP on' }).click();
  await expect.element(screen.getByRole('switch', { name: 'Turn banIP off' })).toBeVisible();
  expect(savedFeeds()).toEqual([...feedsOf('recommended')].sort());
  await expect.element(screen.getByRole('radio', { name: /^Recommended/ })).toHaveAttribute('aria-checked', 'true');
});

test('lists already saved and nothing picked: the switch keeps them', async () => {
  router.options = { ban_feed: [...feedsOf('strict')] };
  const screen = await drawPage();
  await screen.getByRole('switch', { name: 'Turn banIP on' }).click();
  await expect.element(screen.getByRole('switch', { name: 'Turn banIP off' })).toBeVisible();
  expect(router.saves).toEqual([]);
  await expect.element(screen.getByRole('radio', { name: /^Strict/ })).toHaveAttribute('aria-checked', 'true');
});
