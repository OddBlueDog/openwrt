// The traffic rule sheet against the pretend router's busy household: a new
// rule opening every port is held back, a service preset fills it in, and a
// save that fails keeps the sheet open with the failure while one that goes
// through hands over the changes.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { loadFirewall } from '@/features/firewall/api';
import { RuleSheet } from '@/features/firewall/rule-sheet';
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

afterEach(async () => {
  await cleanup();
});

type Submit = (changes: Change[]) => Promise<string | undefined>;

async function draw(onSubmit: Submit): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  const data = await loadFirewall();
  return renderWithProviders(
    <TooltipProvider>
      <RuleSheet rule={undefined} preset={undefined} data={data} onClose={vi.fn()} onSubmit={onSubmit} />
    </TooltipProvider>,
  );
}

test('a new rule that would open every port is held back until it names ports', async () => {
  const screen = await draw(vi.fn<Submit>());
  await screen.getByRole('textbox', { name: 'Name' }).fill('Allow-x');
  await expect.element(screen.getByText('Saving this opens every port')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
  await screen.getByRole('button', { name: 'WireGuard' }).click();
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Allow-WireGuard');
  await expect.element(screen.getByRole('button', { name: 'Save rule' })).toBeEnabled();
});

test('a save that fails keeps the sheet open with the failure; the next one hands over the changes', async () => {
  const onSubmit = vi.fn<Submit>(() => Promise.resolve('The router is not responding'));
  const screen = await draw(onSubmit);
  await screen.getByRole('button', { name: 'WireGuard' }).click();
  await screen.getByRole('button', { name: 'Save rule' }).click();
  await expect.element(screen.getByText('The router is not responding')).toBeVisible();
  expect(onSubmit.mock.calls[0]?.[0][0]).toMatchObject({ op: 'add', config: 'firewall', type: 'rule' });
  onSubmit.mockImplementation(() => Promise.resolve(undefined));
  await screen.getByRole('button', { name: 'Save rule' }).click();
  await vi.waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
  await vi.waitFor(() => {
    expect(screen.getByText('The router is not responding').elements()).toHaveLength(0);
  });
});
