// The Firewall page's traffic rules in a real browser, against the pretend
// router's busy household (router.ts: Device control's three rules, one
// chain): order decides, so a rule moves by its grip (the arrow keys, or a
// drag that only the grip starts) within its chain, and by its card's arrows
// on a phone; OpenWrt's standard rules fold into one row until shown.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type FirewallData, loadFirewall } from '@/features/firewall/api';
import type { Actions } from '@/features/firewall/forms';
import type { Rule } from '@/features/firewall/model';
import { RulesTable } from '@/features/firewall/rules-table';
import type { Change } from '@/lib/api/uci';
import type * as Ubus from '@/lib/ubus';
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

const applied: Change[][] = [];
const actions: Actions = {
  applying: false,
  apply: (changes) => {
    applied.push(changes);
  },
  editForward: () => undefined,
  editRule: () => undefined,
  editNat: () => undefined,
  blockDevice: () => undefined,
  confirm: () => undefined,
};

beforeEach(() => {
  applied.length = 0;
  window.localStorage.removeItem('milkflint.firewall.show-openwrt-rules');
});
afterEach(cleanup);

async function draw(data: FirewallData, width?: number): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  return renderWithProviders(
    <TooltipProvider>
      <div style={width === undefined ? {} : { width }}>
        <RulesTable data={data} counters={undefined} actions={actions} />
      </div>
    </TooltipProvider>,
  );
}

/** The section of the rule with this name. */
function section(data: FirewallData, name: string): string {
  return data.cfg.rules.find((r) => r.name === name)?.section ?? '';
}

/** Where the last order sent puts these sections. */
function placeOf(...sections: string[]): number[] {
  const change = applied.at(-1)?.[0];
  return change?.op === 'order' ? sections.map((s) => change.sections.indexOf(s)) : [];
}

const grip = (name: string): string => `Move ${name}: drag, or use the up and down arrow keys`;

test('the arrow keys move a focused grip’s rule within its chain, not past its ends', async () => {
  const data = await loadFirewall();
  const screen = await draw(data);
  (screen.getByRole('button', { name: grip('Sam: School nights') }).element() as HTMLElement).focus();
  await userEvent.keyboard('{ArrowDown}');
  const [moved, next] = placeOf(section(data, 'Sam: School nights'), section(data, 'Sam: School nights (morning)'));
  expect(moved).toBeGreaterThan(next ?? Infinity);
  // the first rule has nothing above it
  applied.length = 0;
  (screen.getByRole('button', { name: grip('Device control: paused') }).element() as HTMLElement).focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(applied).toHaveLength(0);
});

test('a drag from the grip moves the rule onto the row it’s dropped on, which lights up; elsewhere a drag doesn’t start', async () => {
  const data = await loadFirewall();
  const screen = await draw(data);
  const handle = screen.getByRole('button', { name: grip('Device control: paused') }).element();
  const row = handle.closest('tr');
  const target = screen
    .getByRole('button', { name: grip('Sam: School nights (morning)') })
    .element()
    .closest('tr');
  if (row === null || target === null) throw new Error('no rows');
  const dataTransfer = new DataTransfer();
  const fire = (el: Element, type: string): DragEvent => {
    const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
    el.dispatchEvent(e);
    return e;
  };
  // pressed on the name, the row won't drag
  row.querySelectorAll('td')[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(fire(row, 'dragstart').defaultPrevented).toBe(true);
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(fire(row, 'dragstart').defaultPrevented).toBe(false);
  await expect.poll(() => fire(target, 'dragover').defaultPrevented).toBe(true);
  await expect.element(target).toHaveClass('bg-primary-subtle');
  fire(target, 'drop');
  fire(row, 'dragend');
  const [moved, onto] = placeOf(section(data, 'Device control: paused'), section(data, 'Sam: School nights (morning)'));
  expect(moved).toBeGreaterThan(onto ?? Infinity);
  await expect.element(target).not.toHaveClass('bg-primary-subtle');
});

test('on a phone each rule is a card whose arrows move it', async () => {
  const data = await loadFirewall();
  const screen = await draw(data, 400);
  await expect.element(screen.getByRole('list', { name: 'Traffic rules: any zone forwarded' })).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Move Device control: paused up' })).toBeDisabled();
  await screen.getByRole('button', { name: 'Move Sam: School nights up' }).click();
  const [moved, above] = placeOf(section(data, 'Sam: School nights'), section(data, 'Device control: paused'));
  expect(moved).toBeLessThan(above ?? -Infinity);
});

test('a run of OpenWrt’s standard rules is one row until shown, and a move steps over it whole', async () => {
  const data = await loadFirewall();
  const [base, ...others] = data.cfg.rules;
  if (base === undefined) throw new Error('no rules');
  const openwrt = (name: string): Rule => ({ ...base, section: name.toLowerCase(), label: name, name, srcMac: [], extra: [] });
  const rules = [base, openwrt('Allow-Ping'), openwrt('Allow-IGMP'), ...others];
  const withRun: FirewallData = {
    ...data,
    cfg: {
      ...data.cfg,
      rules,
      order: [...rules.map((r) => r.section), ...data.cfg.order.filter((s) => !rules.some((r) => r.section === s))],
    },
  };
  const screen = await draw(withRun);
  const table = screen.getByRole('table', { name: 'Traffic rules' });
  await expect.element(table.getByText('2 standard rules from OpenWrt')).toBeVisible();
  // down from above the run lands after its last rule
  (screen.getByRole('button', { name: grip(base.name ?? '') }).element() as HTMLElement).focus();
  await userEvent.keyboard('{ArrowDown}');
  const [moved, last] = placeOf(base.section, 'allow-igmp');
  expect(moved).toBe((last ?? -1) + 1);
  await table.getByRole('button', { name: 'Show them' }).click();
  await expect.element(table.getByText('Allow-Ping', { exact: true })).toBeVisible();
  await expect.element(screen.getByRole('switch', { name: 'Show OpenWrt’s rules' })).toBeChecked();
});
