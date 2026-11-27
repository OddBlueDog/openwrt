// Signing in: a wrong password says so, an unreachable router says that,
// and a second try clears the last error while it's on its way.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type * as Ubus from '@/lib/ubus';
import { LoginPage } from '@/pages/login';
import { renderWithProviders } from './render';

const answer = vi.hoisted((): { kind: 'wrong' | 'away' } => ({ kind: 'wrong' }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    callAnonymous: (object: string, method: string) =>
      Promise.reject(
        answer.kind === 'wrong'
          ? new real.UbusError(object, method, real.UbusStatus.permissionDenied)
          : new real.UnreachableError(new TypeError('Failed to fetch')),
      ),
  };
});

afterEach(async () => {
  await cleanup();
});

test('a wrong password, then an unreachable router, each say so', async () => {
  answer.kind = 'wrong';
  const screen = await renderWithProviders(
    <TooltipProvider>
      <LoginPage reason={undefined} />
    </TooltipProvider>,
  );
  await screen.getByLabelText('Admin password').fill('nope');
  await screen.getByRole('button', { name: 'Sign in' }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Wrong password.');
  await expect.element(screen.getByLabelText('Admin password')).toHaveAttribute('aria-invalid', 'true');

  answer.kind = 'away';
  await screen.getByRole('button', { name: 'Sign in' }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent('The router is not responding. Check the connection.');
});
