// Router access in a real browser, against a pretend router with Dropbear
// as OpenWrt sets it, one Ed25519 key and a 1024-bit RSA key in
// authorized_keys, and OpenWrt's and MilkFlint's package keys: the answer
// says what SSH takes; the tabs are in the address; the keys' table with
// its suggestions (a weak key flagged, still signing in), keys added to the
// end of the file whatever their type (the lines before them as they were),
// the lockout caught on the SSH tab, and the package keys that came with the
// firmware kept.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RouterAccessPage } from '@/features/admin-password/page';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const ED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBaaJ2hfIBm7nXi+R0q1CBQtBTdhNh/e41OEqN1Ei6Jd laptop@example';
const SK =
  'sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gAAAABHNzaDo= yubikey';
const RSA1024 =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDD7w6+vAaSiINJFNxFbvS4qJy1aCYMqsWk+R72sLWdmFE3QwQYyP+qznxuiDErjFmq9rQiEeuzlgTZq1Y+V1IB9QRnBM172GxnM08pqY5f+5RfK7dRXyamiMAMBIkHgRHJzjJqwxneS1YycUTQ4jMMYlBevJkCt0pBJHi9limjdQ== tiny';
const EC =
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFpFvOh5DClmTWyktKGSomdPdrzxoTkYqIqpEHkiBVEUMFpUHAgHosj6MXBeWK+3zXo8WlLU7mbf8NmWfECkFhg= phone';
const PQ = 'ssh-mldsa44-ed25519 AAAAE3NzaC1tbGRzYTQ0LWVkMjU1MTkAAAABAA== pq';
const PEM =
  '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEF8Ix3XAfZCLt3hK8iZASAxfhFm\n-----END PUBLIC KEY-----\n';

const router = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: [] as { path: string; data: string }[],
  removed: [] as string[],
}));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  const notFound = (o: string, m: string): Error => new real.UbusError(o, m, real.UbusStatus.notFound);
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const path = String(params['path']);
      const section = (name: string, type: string, options: Record<string, string>): unknown => ({
        '.anonymous': false,
        '.type': type,
        '.name': name,
        '.index': 0,
        ...options,
      });
      let raw: unknown;
      switch (`${object} ${method}`) {
        case 'uci get':
          raw =
            params['config'] === 'dropbear'
              ? {
                  values: {
                    main: section('main', 'dropbear', { enable: '1', PasswordAuth: 'on', RootPasswordAuth: 'on', Port: '22' }),
                  },
                }
              : params['config'] === 'uhttpd'
                ? { values: { main: section('main', 'uhttpd', { redirect_https: '0' }) } }
                : answer('busy', object, method, params);
          break;
        case 'file read': {
          const data = router.files.get(path);
          if (data === undefined) throw notFound(object, method);
          raw = { data };
          break;
        }
        case 'file list':
          raw = {
            entries: [...router.files.keys()]
              .filter((p) => p.startsWith(`${path}/`))
              .map((p) => ({ name: p.slice(path.length + 1), type: 'file' })),
          };
          break;
        case 'milkflint.https status':
          raw = { tls: true, generator: true, own: true, cert: null, running: true, https: ['0.0.0.0:443'], redirect: false };
          break;
        default:
          raw = answer('busy', object, method, params);
      }
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
    exec: (object: string, method: string, params: Record<string, unknown> = {}) => {
      const path = String(params['path']);
      if (`${object} ${method}` === 'file write') {
        router.files.set(path, String(params['data']));
        router.writes.push({ path, data: String(params['data']) });
      } else if (`${object} ${method}` === 'file remove') {
        router.files.delete(path);
        router.removed.push(path);
      }
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  router.files = new Map([
    ['/etc/dropbear/authorized_keys', `# added by hand\n${ED}\n${RSA1024}\n`],
    ['/etc/apk/keys/openwrt-25.12.pem', PEM],
    ['/etc/apk/keys/public-key.pem', PEM.replace('F8Ix', 'AAAA')],
    ['/etc/apk/keys/my-feed.pem', PEM.replace('F8Ix', 'BBBB')],
  ]);
  router.writes = [];
  router.removed = [];
});

afterEach(async () => {
  await cleanup();
});

async function draw(sub = ''): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = `#/admin-password${sub}`;
  return renderWithProviders(
    <TooltipProvider>
      <RouterAccessPage />
    </TooltipProvider>,
  );
}

test('the answer says SSH takes keys and the password; the password’s line says a key signs in without it', async () => {
  const screen = await draw();
  const answer = screen.getByRole('region', { name: 'Router access now' });
  await expect.element(answer.getByText('Keys and password')).toBeVisible();
  // the 1024-bit RSA key is weak, but it signs in
  await expect.element(answer.getByText(/On port 22, 2 keys that sign in/)).toBeVisible();
  await expect.element(answer.getByText(/An SSH key signs in without it/)).toBeVisible();
});

test('SSH keys: the table with its suggestions; keys of any type added at the end of the file', async () => {
  const screen = await draw('/ssh-keys');
  await expect.element(screen.getByRole('tab', { name: 'SSH keys' })).toHaveAttribute('aria-selected', 'true');
  const table = screen.getByRole('table', { name: 'SSH keys' });
  await expect.element(table.getByText('SHA256:q1d8QJC72rqWrrhVYexlUbuOtPntwV6e+QFs4h9PcA0')).toBeVisible();
  await expect.element(table.getByText(/1024-bit RSA key still signs in/)).toBeVisible();
  await expect.element(table.getByText('Weak')).toBeVisible();
  await expect.element(table.getByText('Recommended')).toBeVisible();

  const field = screen.getByRole('textbox', { name: 'A public key to add' });
  // an ECDSA key: not the one to make, but one people have, and it works
  await field.fill(EC);
  await screen.getByRole('button', { name: 'Add key' }).click();
  await expect.element(table.getByText('SHA256:L8cqOBRWDJqvsJ0mbtbiK7H1iQbZyb57jhmSqjv7Yv8')).toBeVisible();
  await field.fill(SK);
  await screen.getByRole('button', { name: 'Add key' }).click();
  await expect.element(table.getByText('SHA256:nX0hpi5mKbTIJ10yBq5/sLQhiI1Y0RBAqN0drDdgJWs')).toBeVisible();
  expect(router.writes.map((w) => w.data)).toEqual([
    `# added by hand\n${ED}\n${RSA1024}\n${EC}\n`,
    `# added by hand\n${ED}\n${RSA1024}\n${EC}\n${SK}\n`,
  ]);
});

test('SSH: password logins off with no key that signs in can’t be saved', async () => {
  // a post-quantum key waits for a Dropbear that takes it: it doesn't sign in
  router.files.set('/etc/dropbear/authorized_keys', `${PQ}\n`);
  const screen = await draw('/ssh');
  await screen.getByRole('switch', { name: 'Password logins' }).click();
  await expect.element(screen.getByText(/Add an SSH key first/)).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Save & apply' })).toBeDisabled();
});

test('Package keys: the firmware’s own can’t be removed; another can, after a confirm', async () => {
  const screen = await draw('/package-keys');
  const table = screen.getByRole('table', { name: 'Package keys' });
  await expect.element(table.getByText('my-feed.pem')).toBeVisible();
  expect(table.getByRole('button', { name: 'Remove openwrt-25.12.pem' }).elements()).toEqual([]);
  expect(table.getByRole('button', { name: 'Remove public-key.pem' }).elements()).toEqual([]);
  await table.getByRole('button', { name: 'Remove my-feed.pem' }).click();
  await screen.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => router.removed).toEqual(['/etc/apk/keys/my-feed.pem']);
});
