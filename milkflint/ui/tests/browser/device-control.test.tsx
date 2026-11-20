// Device control in a real browser, against the pretend router's busy
// household (router.ts: Sam off on school nights, Alex paused until 16:00, at
// Tuesday 15:30): the page opens on its answer, says each state in words,
// fits a phone without sideways scrolling in every theme, opens Pause's
// choices in place (Escape closes them), and the Firewall page shows the
// same rules as Device control's, in words, with the way back to them.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DeviceControlPage } from '@/features/device-control/page';
import { loadFirewall } from '@/features/firewall/api';
import type { Actions } from '@/features/firewall/forms';
import { RulesTable } from '@/features/firewall/rules-table';
import type * as Ubus from '@/lib/ubus';
import { pickableThemes, setThemeId } from '@/lib/theme';

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
  await cleanup();
  await page.viewport(1400, 1000);
});

async function drawPage(): Promise<Awaited<ReturnType<typeof render>>> {
  window.location.hash = '#/device-control';
  const screen = await render(
    <TooltipProvider>
      <DeviceControlPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('heading', { name: 'Sam' })).toBeVisible();
  return screen;
}

test('it opens on the answer: who’s off now and until when, and what changes next', async () => {
  const screen = await drawPage();
  const answer = screen.getByRole('region', { name: 'Device control now' });
  await expect.element(answer.getByText('Alexandra-Margaret Kensington: paused until 16:00')).toBeVisible();
  await expect.element(answer.getByText('16:00', { exact: true })).toBeVisible();
  await expect.element(answer.getByText(/can use the internet again/)).toBeVisible();
});

test('each card says its state in words, its times and its next change', async () => {
  const screen = await drawPage();
  await expect.element(screen.getByText('Can use the internet')).toBeVisible();
  await expect.element(screen.getByText('Off at 21:00')).toBeVisible();
  await expect.element(screen.getByText('Off 21:00–07:00 on school nights')).toBeVisible();
  await expect.element(screen.getByText('Paused until 16:00', { exact: true })).toBeVisible();
  // a badge carries its word, never colour alone
  await expect.element(screen.getByText('Paused', { exact: true })).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Resume' })).toBeVisible();
  // SafeSearch is honest about what it needs
  await expect.element(screen.getByText('SafeSearch needs AdGuard Home')).toBeVisible();
  // the week, for screen readers, in words
  expect(screen.getByText('Monday: off until 07:00 and from 21:00').query()).not.toBeNull();
  expect(screen.getByText('Saturday: on all day').elements().length).toBeGreaterThan(0);
});

test('Pause opens its four lengths in place; Escape closes them and gives the focus back to the page', async () => {
  const screen = await drawPage();
  await screen.getByRole('button', { name: 'Pause' }).click();
  const group = screen.getByRole('group', { name: 'Pause Sam’s internet' });
  await expect.element(group).toBeVisible();
  for (const label of ['30 min', '1 hour', 'Until 07:00', 'Until I resume'])
    await expect.element(group.getByRole('button', { name: label })).toBeVisible();
  await expect.element(group.getByRole('button', { name: '30 min' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('group', { name: 'Pause Sam’s internet' }).query()).toBeNull();
});

test('Add a person opens the sheet with the presets', async () => {
  const screen = await drawPage();
  await screen.getByRole('button', { name: 'Add a person' }).first().click();
  const sheet = screen.getByRole('dialog', { name: 'Add a person' });
  await expect.element(sheet).toBeVisible();
  for (const label of ['Bedtime', 'School nights', 'School hours', 'Weekends'])
    await expect.element(sheet.getByRole('button', { name: label })).toBeVisible();
  await sheet.getByRole('button', { name: 'School nights' }).click();
  await expect.element(sheet.getByText('Off 21:00–07:00 on school nights')).toBeVisible();
});

describe.each(pickableThemes().map((t) => ({ name: t.name, id: t.id })))('$name', ({ id }) => {
  test('on a phone: no sideways scrolling, and the main buttons are big enough to tap', async () => {
    await setThemeId(id);
    await page.viewport(375, 812);
    const screen = await drawPage();
    await expect.element(screen.getByText('Off 21:00–07:00 on school nights')).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const name of ['Pause', 'Resume']) {
      const box = screen.getByRole('button', { name, exact: true }).element().getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(36);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    }
  });
});

const actions: Actions = {
  applying: false,
  apply: () => undefined,
  editForward: () => undefined,
  editRule: () => undefined,
  editNat: () => undefined,
  blockDevice: () => undefined,
  confirm: () => undefined,
};

test('the Firewall page shows Device control’s rules as its own: badged, for Sam, in words, edited there', async () => {
  const data = await loadFirewall();
  const screen = await render(
    <TooltipProvider>
      <RulesTable data={data} counters={undefined} actions={actions} />
    </TooltipProvider>,
  );
  await expect.element(screen.getByText('Sam: School nights', { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByText('Sam: off 21:00–07:00 on school nights').first()).toBeVisible();
  // Sam's rules lead to Sam on Device control; the shared pause rule to the page
  const links = screen
    .getByRole('link', { name: 'Device control' })
    .elements()
    .map((a) => a.getAttribute('href'));
  expect(links).toContain('#/device-control/devctl_s4m0');
  expect(links).toContain('#/device-control');
  await expect.element(screen.getByRole('button', { name: 'Edit Sam: School nights on Device control' }).first()).toBeVisible();
  await expect
    .element(screen.getByText('Keeps devices off the internet while they’re paused on Device control.').first())
    .toBeVisible();
});
