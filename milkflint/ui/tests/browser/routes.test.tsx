// The app's routes: every old address lands where it did (Home for one that
// names no page, the join page outside the sign-in gate), a link built with
// pageLink goes to the address href gives, and a tab change keeps the page
// mounted, so what's typed on it survives.
import { createMemoryHistory, Link, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { featureIds } from '@/features/ids';
import { createQueryClient } from '@/lib/query/client';
import { href, pageLink, routeOf, subPathOf, useRoute, useSubPath } from '@/lib/router';
import { createAppRouter } from '@/router';
import { renderWithProviders } from './render';

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

async function matched(path: string): Promise<{ route: string; feature: string; sub: string }> {
  const router = createAppRouter(createQueryClient(), createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const { pathname } = router.state.location;
  return { route: router.state.matches.at(-1)?.routeId ?? '', feature: routeOf(pathname), sub: subPathOf(pathname) };
}

test('each old address lands where it did', async () => {
  expect(await matched('/')).toEqual({ route: '/$', feature: 'dashboard', sub: '' });
  expect(await matched('/dashboard')).toEqual({ route: '/$', feature: 'dashboard', sub: '' });
  expect(await matched('/lan')).toEqual({ route: '/$', feature: 'lan', sub: '' });
  expect(await matched('/lan/addresses')).toEqual({ route: '/$', feature: 'lan', sub: 'addresses' });
  expect(await matched('/logs/radar/more')).toEqual({ route: '/$', feature: 'logs', sub: 'radar/more' });
  // a name that's no page: Home, as before
  expect(await matched('/nope')).toEqual({ route: '/$', feature: 'dashboard', sub: '' });
  // the test bench's own page, and the join page outside the sign-in gate
  expect(await matched('/test-bench')).toEqual({ route: '/$', feature: 'test-bench', sub: '' });
  expect((await matched('/test-bench/join/abc')).route).toBe('/test-bench/join/$');
  expect((await matched('/test-bench/join')).route).toBe('/test-bench/join/$');
  // development's specimen page is the page route's to show (App checks for it)
  expect(await matched('/specimen')).toEqual({ route: '/$', feature: 'dashboard', sub: '' });
});

test('signed out, a page’s address reads nothing: no refusal is kept in the cache to greet the page after signing in', async () => {
  const fetch = vi.spyOn(window, 'fetch');
  const client = createQueryClient();
  // DNS has a prefetch: signed in, its route starts the page's read while the code loads
  const router = createAppRouter(client, createMemoryHistory({ initialEntries: ['/dns'] }));
  await router.load();
  expect(router.state.matches.at(-1)?.routeId).toBe('/$');
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});

test('pageLink makes the same address as href, for every page with and without a tab', async () => {
  const links = featureIds.flatMap((id) => [
    { id, sub: undefined },
    { id, sub: 'tab' },
  ]);
  const screen = await renderWithProviders(
    <>
      {links.map(({ id, sub }) => (
        <Link key={`${id}/${sub ?? ''}`} {...pageLink(id, sub)} data-want={href(id, sub)}>
          {id}
        </Link>
      ))}
    </>,
    { path: '/' },
  );
  await expect.element(screen.getByRole('link', { name: 'lan' }).first()).toBeVisible();
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[data-want]')];
  expect(anchors).toHaveLength(links.length);
  // hash history writes the page's own path before the "#": the same address once resolved
  for (const a of anchors) expect(a.href).toBe(new URL(a.dataset['want'] ?? '', window.location.href).href);
});

let mounts = 0;

function Tabbed(): ReactElement {
  const [typed, setTyped] = useState('');
  const [counted] = useState(() => ++mounts);
  const route = useRoute();
  const sub = useSubPath();
  const navigate = useNavigate();
  return (
    <>
      <p>
        {route} / {sub === '' ? 'first tab' : sub} / mount {counted}
      </p>
      <input
        aria-label="typed"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
      />
      <Link {...pageLink('lan', 'addresses')}>Addresses</Link>
      <button
        type="button"
        onClick={() => {
          void navigate(pageLink('lan'));
        }}
      >
        Settings
      </button>
    </>
  );
}

test('a tab change keeps the page mounted: a link, navigate, and the address typed by hand', async () => {
  mounts = 0;
  const screen = await renderWithProviders(<Tabbed />, { path: '/lan' });
  await expect.element(screen.getByText('lan / first tab / mount 1')).toBeVisible();
  await screen.getByRole('textbox', { name: 'typed' }).fill('kept');

  await screen.getByRole('link', { name: 'Addresses' }).click();
  await expect.element(screen.getByText('lan / addresses / mount 1')).toBeVisible();
  expect(window.location.hash).toBe('#/lan/addresses');

  await screen.getByRole('button', { name: 'Settings' }).click();
  await expect.element(screen.getByText('lan / first tab / mount 1')).toBeVisible();
  expect(window.location.hash).toBe('#/lan');

  window.location.hash = '#/lan/connections';
  await expect.element(screen.getByText('lan / connections / mount 1')).toBeVisible();

  history.back();
  await expect.element(screen.getByText('lan / first tab / mount 1')).toBeVisible();
  await expect.element(screen.getByRole('textbox', { name: 'typed' })).toHaveValue('kept');
});
