// Router access's password card: an empty box isn't marked wrong, a short
// password and a mismatch are, the button stays off until both are right,
// and a change is sent once and clears the boxes.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PasswordCard } from '@/features/admin-password/password-card';
import type { ApplyState } from '@/hooks/use-apply';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const sent = vi.hoisted((): { object: string; method: string; params: Record<string, unknown> }[] => []);

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    exec: (object: string, method: string, params: Record<string, unknown> = {}) => {
      sent.push({ object, method, params });
      return Promise.resolve();
    },
  };
});

afterEach(async () => {
  sent.length = 0;
  await cleanup();
});

test('empty boxes aren’t wrong; short and mismatched ones are; a change is sent once and clears them', async () => {
  const results: ApplyState[] = [];
  const screen = await renderWithProviders(
    <TooltipProvider>
      <PasswordCard
        password="none"
        where="here and in LuCI"
        onResult={(s) => {
          results.push(s);
        }}
      />
    </TooltipProvider>,
  );
  const button = screen.getByRole('button', { name: 'Set password' });
  await expect.element(button).toBeDisabled();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);

  await screen.getByLabelText('New password').fill('short');
  await expect.element(screen.getByText('Use at least 8 characters.')).toBeVisible();
  await screen.getByLabelText('New password').fill('a long enough one');
  await screen.getByLabelText('Type it again').fill('a long enough tw');
  await expect.element(screen.getByText('The two don’t match.')).toBeVisible();
  await expect.element(button).toBeDisabled();

  await screen.getByLabelText('Type it again').fill('a long enough one');
  await expect.element(button).toBeEnabled();
  await button.click();
  await vi.waitFor(() => {
    expect(results.at(-1)?.phase).toBe('done');
  });
  expect(sent).toEqual([{ object: 'luci', method: 'setPassword', params: { username: 'root', password: 'a long enough one' } }]);
  await expect.element(screen.getByLabelText('New password')).toHaveValue('');
});
