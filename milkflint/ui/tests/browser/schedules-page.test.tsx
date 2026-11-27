// Scheduled tasks against a pretend crontab: a line cron won't read holds
// the save back (unless it was there already), and a save writes the file
// only if it's still as read, has cron take it, and reads it back.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SchedulesPage } from '@/features/schedules/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const router = vi.hoisted(() => ({ file: '', calls: [] as string[] }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: (object: string, method: string, _params: unknown, schema: { parse: (v: unknown) => unknown }) => {
      router.calls.push(`${object}.${method}`);
      if (`${object}.${method}` === 'file.read') return Promise.resolve(schema.parse({ data: router.file }));
      if (`${object}.${method}` === 'file.exec') return Promise.resolve(schema.parse({ code: 0 }));
      return Promise.reject(new real.UbusError(object, method, real.UbusStatus.methodNotFound));
    },
    exec: (object: string, method: string, params: Record<string, unknown> = {}) => {
      router.calls.push(`${object}.${method}`);
      if (`${object}.${method}` === 'file.write' && typeof params['data'] === 'string') router.file = params['data'];
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  router.file = '0 4 * * * /sbin/reboot\n';
  router.calls = [];
});

afterEach(async () => {
  await cleanup();
});

async function crontab(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  const screen = await renderWithProviders(
    <TooltipProvider>
      <SchedulesPage />
    </TooltipProvider>,
  );
  await screen.getByRole('radio', { name: 'Crontab' }).click();
  await expect.element(screen.getByRole('textbox', { name: 'The crontab, a job a line' })).toBeVisible();
  return screen;
}

test('a line cron won’t read holds the save back', async () => {
  const screen = await crontab();
  await screen.getByRole('textbox', { name: 'The crontab, a job a line' }).fill('0 4 * * * /sbin/reboot\nnot a job\n');
  await expect.element(screen.getByRole('button', { name: 'Save & apply' })).toBeDisabled();
  await expect.element(screen.getByText('Fix the highlighted fields to save.')).toBeVisible();
});

test('a save writes the file, has cron take it, and reads it back; the save bar goes', async () => {
  const screen = await crontab();
  await screen.getByRole('textbox', { name: 'The crontab, a job a line' }).fill('0 5 * * * /sbin/reboot');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(router.file).toBe('0 5 * * * /sbin/reboot\n');
  });
  await vi.waitFor(() => {
    expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
  });
  expect(router.calls.filter((c) => c === 'file.exec')).toHaveLength(2);
  expect(router.calls.filter((c) => c === 'file.read').length).toBeGreaterThanOrEqual(3);
});
