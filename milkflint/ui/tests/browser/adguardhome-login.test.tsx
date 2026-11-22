// AdGuard Home's "Use router login" toggle: on by default during first-time
// setup (no separate password needed), switching off shows the password form
// without leaving AdGuard Home unprotected until saved, switching back on drops
// the separate password, and "Open AdGuard Home" uses the session handoff when
// router login is on.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type * as Api from '@/features/adguardhome/api';
import { AdGuardHomePage } from '@/features/adguardhome/page';
import type * as Uci from '@/lib/api/uci';

interface PretendAdGuard {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  routerLogin: boolean;
  user: string | null;
  /** its web interface's address: by default on the host this page is at, as on the router's home address */
  url: string;
  calls: { method: string; args?: unknown }[];
}

const SAME_HOST = `http://${window.location.hostname}:3000/`;

const router: PretendAdGuard = vi.hoisted(() => ({
  configured: false,
  enabled: false,
  running: false,
  routerLogin: true,
  user: null,
  url: '',
  calls: [],
}));

vi.mock('@/lib/api/uci', async (importOriginal) => {
  const real = await importOriginal<typeof Uci>();
  return { ...real, getConfig: () => Promise.resolve([]) };
});

vi.mock('@/features/adguardhome/api', async (importOriginal) => {
  const real = await importOriginal<typeof Api>();
  return {
    ...real,
    getAdGuardStatus: () =>
      Promise.resolve({
        installed: true,
        configured: router.configured,
        enabled: router.enabled,
        mode: 'router',
        running: router.running,
        version: '1.0.0-r1',
        router_login: router.routerLogin,
        user: router.user,
        url: router.url,
        state: router.enabled ? 'active' : 'off',
        settings: [],
        networks: [],
      } as Api.AdGuardStatus),
    setupAdGuard: (choice: Api.SetupChoice) => {
      router.calls.push({ method: 'setup', args: choice });
      router.configured = true;
      router.enabled = true;
      router.running = true;
      router.routerLogin = choice.routerLogin;
      router.user = choice.routerLogin ? null : choice.user;
      return Promise.resolve();
    },
    setCredentials: (user: string, password: string) => {
      router.calls.push({ method: 'credentials', args: { user, password } });
      router.routerLogin = false;
      router.user = user;
      return Promise.resolve();
    },
    enableRouterLogin: () => {
      router.calls.push({ method: 'router_login' });
      router.routerLogin = true;
      router.user = null;
      return Promise.resolve();
    },
    openAdGuard: () => {
      router.calls.push({ method: 'open' });
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  Object.assign(router, {
    configured: false,
    enabled: false,
    running: false,
    routerLogin: true,
    user: null,
    url: SAME_HOST,
    calls: [],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

async function drawPage(): Promise<Awaited<ReturnType<typeof render>>> {
  const screen = await render(
    <TooltipProvider>
      <AdGuardHomePage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole('heading', { name: 'AdGuard Home', level: 1 })).toBeVisible();
  return screen;
}

async function fillCredentials(screen: Awaited<ReturnType<typeof render>>, user: string, pw: string): Promise<void> {
  await screen.getByLabelText('User name').fill(user);
  await screen.getByLabelText('Password', { exact: true }).fill(pw);
  await screen.getByLabelText('Password again').fill(pw);
}

test('first-time setup: router login is on by default and turns on without a password; off reveals the password form', async () => {
  const screen = await drawPage();
  const toggle = screen.getByRole('switch', { name: 'Use router login' });
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByLabelText('Password', { exact: true })).not.toBeInTheDocument();

  // Toggling off reveals the password form; toggling back on hides it and submits with routerLogin: true
  await toggle.click();
  await expect.element(screen.getByLabelText('Password', { exact: true })).toBeVisible();
  await toggle.click();
  await screen.getByRole('button', { name: 'Turn on AdGuard Home' }).click();

  await expect.element(screen.getByRole('button', { name: /Open AdGuard Home/ })).toBeVisible();
  expect(router.calls).toEqual([{ method: 'setup', args: { routerLogin: true } }]);
});

test('first-time setup with router login off sets the chosen user name and password', async () => {
  const screen = await drawPage();
  await screen.getByRole('switch', { name: 'Use router login' }).click();
  await fillCredentials(screen, 'owner', 'correct horse');
  await screen.getByRole('button', { name: 'Turn on AdGuard Home' }).click();

  await expect.element(screen.getByRole('link', { name: /Open AdGuard Home/ })).toBeVisible();
  expect(router.calls).toEqual([{ method: 'setup', args: { routerLogin: false, user: 'owner', password: 'correct horse' } }]);
});

test('configured: Open AdGuard Home uses session handoff; toggling off requires saving a password, toggling back on switches at once', async () => {
  Object.assign(router, { configured: true, enabled: true, running: true, routerLogin: true });
  const replace = vi.fn();
  const close = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({ opener: window, location: { replace }, close } as unknown as Window);

  const screen = await drawPage();
  await screen.getByRole('button', { name: /Open AdGuard Home/ }).click();
  await vi.waitFor(() => {
    expect(replace).toHaveBeenCalledWith(SAME_HOST);
  });
  expect(router.calls).toEqual([{ method: 'open' }]);

  // Flipping the Sign-in switch off reveals the form without calling the router yet
  const toggle = screen.getByRole('switch', { name: 'Use router login' });
  await toggle.click();
  await expect.element(screen.getByRole('button', { name: 'Use this password' })).toBeVisible();
  expect(router.calls).toHaveLength(1);
  // Changing mind before saving hides it with no RPC
  await toggle.click();
  await expect.element(screen.getByRole('button', { name: 'Use this password' })).not.toBeInTheDocument();
  expect(router.calls).toHaveLength(1);

  // Saving a separate password turns router login off
  await toggle.click();
  await fillCredentials(screen, 'owner', 'new pass phrase');
  await screen.getByRole('button', { name: 'Use this password' }).click();
  await expect.element(screen.getByRole('link', { name: /Open AdGuard Home/ })).toBeVisible();
  expect(router.calls[1]).toEqual({ method: 'credentials', args: { user: 'owner', password: 'new pass phrase' } });

  // Flipping back on calls enableRouterLogin immediately and hides the password form
  await screen.getByRole('switch', { name: 'Use router login' }).click();
  await expect.element(screen.getByRole('button', { name: /Open AdGuard Home/ })).toBeVisible();
  await expect.element(screen.getByLabelText('Password', { exact: true })).not.toBeInTheDocument();
  expect(router.calls[2]).toEqual({ method: 'router_login' });
});

test('opened at another address than AdGuard Home’s (Remote access, IPv6), it sends you to the home address instead', async () => {
  Object.assign(router, { configured: true, enabled: true, running: true, routerLogin: true, url: 'http://192.168.1.1:3000/' });
  const open = vi.spyOn(window, 'open');

  const screen = await drawPage();
  const link = screen.getByRole('link', { name: 'Open this page at 192.168.1.1' });
  await expect.element(link).toHaveAttribute('href', 'http://192.168.1.1/#/adguardhome');
  await expect.element(screen.getByText(/the router login carries over only from the router’s home address/)).toBeVisible();
  // no handoff from here: its cookie couldn't reach AdGuard Home
  await expect.element(screen.getByRole('button', { name: /Open AdGuard Home/ })).not.toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
  expect(router.calls).toEqual([]);
});
