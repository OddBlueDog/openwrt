// The Plan card: its number boxes keep what is typed.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import type { Member, ScheduleRequest } from '@/features/test-bench/api';
import { PlanCard } from '@/features/test-bench/plan-card';
import { planChoices } from '@/features/test-bench/plan-memory';
import { renderWithProviders } from './render';

const mac: Member = { id: 'm1', name: 'Mac', ip: '192.168.1.10', seen_ms: 0, joined: 0, link: { kind: 'wired' } };
const phone: Member = { id: 'm2', name: 'Phone', ip: '192.168.1.11', seen_ms: 0, joined: 0, link: { kind: 'wifi' } };
const sent: ScheduleRequest[] = [];
const onStart = vi.fn((s: ScheduleRequest) => {
  sent.push(s);
  return Promise.resolve();
});

beforeEach(() => {
  planChoices.save(undefined);
});

afterEach(async () => {
  await cleanup();
  onStart.mockClear();
  sent.length = 0;
});

async function show(): Promise<void> {
  await renderWithProviders(<PlanCard members={[mac, phone]} shaper={null} busy={false} onStart={onStart} />);
}

async function startRun(): Promise<ScheduleRequest> {
  await page.getByRole('button', { name: 'Start' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  await vi.waitFor(() => {
    expect(onStart).toHaveBeenCalled();
  });
  const last = sent.at(-1);
  if (last === undefined) throw new Error('nothing was sent');
  return last;
}

test('the data box takes 9000 typed over it', async () => {
  await show();
  const box = page.getByLabelText('Data, each device');
  await userEvent.clear(box);
  await userEvent.type(box, '9000');
  await expect.element(box).toHaveValue(9000);
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect.element(box).toHaveValue(9000);
  const s = await startRun();
  expect(s.options.budget_mb).toBe(9000);
});

test('below the limit it becomes 10 when left', async () => {
  await show();
  const box = page.getByLabelText('Data, each device');
  await userEvent.clear(box);
  await userEvent.type(box, '5');
  await userEvent.tab();
  await expect.element(box).toHaveValue(10);
});

test('left empty it follows the plan again', async () => {
  await show();
  const box = page.getByLabelText('Data, each device');
  await userEvent.clear(box);
  await userEvent.type(box, '9000');
  await userEvent.tab();
  await userEvent.clear(box);
  await userEvent.tab();
  await expect.element(box).toHaveValue(2000);
});

test('the seconds boxes take a typed value', async () => {
  await show();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  const box = page.getByLabelText('Each load');
  await userEvent.clear(box);
  await userEvent.type(box, '30');
  await userEvent.tab();
  await expect.element(box).toHaveValue(30);
});

test('the card comes back to its last choices, not to Rehearsal', async () => {
  await show();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByRole('switch', { name: 'Both ways at once' }).click();
  const load = page.getByLabelText('Each load');
  await userEvent.clear(load);
  await userEvent.type(load, '30');
  await userEvent.tab();
  const box = page.getByLabelText('Data, each device');
  await userEvent.clear(box);
  await userEvent.type(box, '9000');
  await userEvent.tab();
  await page.getByRole('switch', { name: 'Rehearsal' }).click();
  await expect.element(page.getByRole('switch', { name: 'Rehearsal' })).toBeChecked();
  await cleanup();
  await show();
  await expect.element(page.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.element(page.getByRole('switch', { name: 'Both ways at once' })).toBeChecked();
  await expect.element(page.getByLabelText('Each load')).toHaveValue(30);
  await expect.element(page.getByLabelText('Data, each device')).toHaveValue(9000);
  await expect.element(page.getByRole('switch', { name: 'Rehearsal' })).not.toBeChecked();
});

test('storage that throws leaves the card on its defaults', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  try {
    planChoices.save(undefined);
    await show();
    await expect.element(page.getByRole('button', { name: 'Quick check', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Full', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Full', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});

test('the name follows the plan until typed', async () => {
  await show();
  const box = page.getByLabelText('Name');
  await expect.element(box).toHaveValue('Quick check');
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect.element(box).toHaveValue('Full');
  await userEvent.clear(box);
  await userEvent.type(box, 'Before CAKE');
  await page.getByRole('button', { name: 'Quick check', exact: true }).click();
  await expect.element(box).toHaveValue('Before CAKE');
  const s = await startRun();
  expect(s.name).toBe('Before CAKE');
});

test("a name left blank is the plan's title", async () => {
  await show();
  const box = page.getByLabelText('Name');
  await userEvent.clear(box);
  await userEvent.type(box, '   ');
  await userEvent.tab();
  await expect.element(box).toHaveValue('Quick check');
  const s = await startRun();
  expect(s.name).toBe('Quick check');
});

test('typing a site leaves the data limit following the plan', async () => {
  await renderWithProviders(
    <PlanCard
      members={[mac, phone]}
      shaper={{ interface: 'eth1', down_kbit: 500_000, up_kbit: 100_000, qdisc: 'cake' }}
      busy={false}
      onStart={onStart}
    />,
  );
  const box = page.getByLabelText('Data, each device');
  const quick = (box.element() as HTMLInputElement).value;
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  const full = (box.element() as HTMLInputElement).value;
  expect(full).not.toBe(quick);
  await userEvent.type(page.getByLabelText('More sites for DNS and pages'), 'example.org');
  await page.getByRole('button', { name: 'Quick check', exact: true }).click();
  await expect.element(box).toHaveValue(Number(quick));
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect.element(box).toHaveValue(Number(full));
  await vi.waitFor(() => {
    expect(planChoices.get().budget_mb).toBe(0);
  });
});

test('the name goes back to the plan after a run starts', async () => {
  await show();
  const box = page.getByLabelText('Name');
  await userEvent.clear(box);
  await userEvent.type(box, 'Before CAKE');
  await startRun();
  await expect.element(box).toHaveValue('Quick check');
});
