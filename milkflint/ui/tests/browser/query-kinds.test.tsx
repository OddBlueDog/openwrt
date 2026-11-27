// The three kinds of router read in a real browser: a live query's timing
// (as usePoll's was), what makes each kind ask again or not, that several
// reads mounting together still go out as one request, that the browser
// thinking it's offline pauses nothing, and that the cache empties when
// the session ends.
import { onlineManager, useQuery } from '@tanstack/react-query';
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { z } from 'zod';
import { liveQuery, settingsQuery } from '@/lib/query/options';
import { useLive } from '@/lib/query/use-live';
import { login, logout } from '@/lib/session';
import { call } from '@/lib/ubus';
import { renderWithProviders } from './render';

let seen: { at?: number | undefined; next?: number | undefined; data?: unknown; error?: unknown } = {};

function LiveProbe({
  load,
  every,
}: {
  load: () => Promise<number>;
  every: number | ((n: number | undefined) => number);
}): ReactElement {
  const p = useLive(liveQuery(['test', 'live'], load, every));
  seen = { at: p.at, next: p.next, data: p.data, error: p.error };
  return <span>{p.data ?? '-'}</span>;
}

async function setHidden(hidden: boolean): Promise<void> {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(hidden ? 'hidden' : 'visible');
  await act(async () => {
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  seen = {};
});

describe('live timing, as usePoll gave it', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(1_000_000);
  });

  test('a fixed interval: at is the answer, next is the delay armed', async () => {
    await renderWithProviders(<LiveProbe load={() => Promise.resolve(7)} every={30_000} />);
    await vi.waitFor(() => {
      expect(seen.at).toBe(1_000_000);
      expect(seen.next).toBe(1_030_000);
    });
  });

  test('a function interval: next follows the delay it returned', async () => {
    await renderWithProviders(<LiveProbe load={() => Promise.resolve(7)} every={(n) => (n === 7 ? 4_000 : 1)} />);
    await vi.waitFor(() => {
      expect(seen.next).toBe(1_004_000);
    });
  });

  test('next is gone while the page is hidden and back after', async () => {
    await renderWithProviders(<LiveProbe load={() => Promise.resolve(7)} every={30_000} />);
    await vi.waitFor(() => {
      expect(seen.next).toBe(1_030_000);
    });
    await setHidden(true);
    expect(seen.next).toBeUndefined();
    expect(seen.at).toBe(1_000_000);
    await setHidden(false);
    await vi.waitFor(() => {
      expect(seen.next).toBeGreaterThanOrEqual(1_030_000);
    });
  });

  test('a hidden tab stops asking; showing it asks at once', async () => {
    const load = vi.fn(() => Promise.resolve(1));
    await renderWithProviders(<LiveProbe load={load} every={1_000} />);
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
    await setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    await setHidden(false);
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  test('live: a call slower than its interval is never started twice at once', async () => {
    let running = 0;
    let most = 0;
    const load = (): Promise<number> => {
      running++;
      most = Math.max(most, running);
      return new Promise((resolve) => {
        setTimeout(() => {
          running--;
          resolve(1);
        }, 3_000);
      });
    };
    await renderWithProviders(<LiveProbe load={load} every={1_000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(seen.data).toBe(1);
    expect(most).toBe(1);
  });
});

test('live: a refresh that fails keeps the last data and sets error', async () => {
  let fail = false;
  const load = (): Promise<number> => (fail ? Promise.reject(new Error('router away')) : Promise.resolve(5));
  await renderWithProviders(<LiveProbe load={load} every={50} />);
  await vi.waitFor(() => {
    expect(seen.data).toBe(5);
  });
  fail = true;
  await vi.waitFor(() => {
    expect(seen.error).toBeInstanceOf(Error);
  });
  expect(seen.data).toBe(5);
});

function SettingsProbe({ load }: { load: () => Promise<string> }): ReactElement {
  const q = useQuery(settingsQuery(['test', 'settings'], load));
  return <span>{q.data ?? '-'}</span>;
}

test('settings: a window focus event does not refetch', async () => {
  const load = vi.fn(() => Promise.resolve('saved'));
  const screen = await renderWithProviders(<SettingsProbe load={load} />);
  await expect.element(screen.getByText('saved')).toBeVisible();
  await setHidden(true);
  await setHidden(false);
  window.dispatchEvent(new Event('focus'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(load).toHaveBeenCalledTimes(1);
});

test('a query still fetches while navigator.onLine is false', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  onlineManager.setOnline(false);
  try {
    const screen = await renderWithProviders(<SettingsProbe load={() => Promise.resolve('answered')} />);
    await expect.element(screen.getByText('answered')).toBeVisible();
  } finally {
    onlineManager.setOnline(true);
  }
});

// a pretend /ubus: answers every call with `result`, and counts the POSTs
const rpcRequest = z.object({ id: z.number(), params: z.tuple([z.string(), z.string(), z.string()], z.unknown()) });
function fakeUbus(answer: (object: string, method: string) => unknown): { posts: unknown[][] } {
  const posts: unknown[][] = [];
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    // logout's best-effort AdGuard Home sign-out
    if (input !== '/ubus') return Promise.resolve(Response.json({}));
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const items = Array.isArray(body) ? body : [body];
    posts.push(items);
    const replies = items.map((item: unknown) => {
      const { id, params } = rpcRequest.parse(item);
      const reply = answer(params[1], params[2]);
      return reply instanceof Error
        ? { jsonrpc: '2.0', id, error: { code: -32002, message: 'Access denied' } }
        : { jsonrpc: '2.0', id, result: [0, reply] };
    });
    return Promise.resolve(Response.json(Array.isArray(body) ? replies : replies[0]));
  });
  return { posts };
}

function Reader({ name }: { name: string }): ReactElement {
  const q = useQuery(settingsQuery(['test', name], () => call('test', name, {}, z.object({ n: z.number() }))));
  return <span>{q.data === undefined ? '-' : `${name} ${String(q.data.n)}`}</span>;
}

test('three queries mounting together make one POST', async () => {
  const { posts } = fakeUbus(() => ({ n: 1 }));
  const screen = await renderWithProviders(
    <>
      <Reader name="a" />
      <Reader name="b" />
      <Reader name="c" />
    </>,
  );
  await expect.element(screen.getByText('c 1')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toHaveLength(3);
});

const SESSION = 'a'.repeat(32);

async function signIn(): Promise<void> {
  fakeUbus((object, method) =>
    object === 'session' && method === 'login'
      ? { ubus_rpc_session: SESSION, data: { username: 'root' } }
      : object === 'milkflint.adminpassword'
        ? { set: true }
        : { n: 1 },
  );
  await login('root', 'secret');
}

test('logout empties the cache', async () => {
  await signIn();
  const screen = await renderWithProviders(<Reader name="key" />);
  await expect.element(screen.getByText('key 1')).toBeVisible();
  expect(screen.client.getQueryCache().getAll().length).toBeGreaterThan(0);
  await logout();
  expect(screen.client.getQueryCache().getAll()).toHaveLength(0);
});

test('session expiry empties the cache', async () => {
  await signIn();
  const screen = await renderWithProviders(<Reader name="key" />);
  await expect.element(screen.getByText('key 1')).toBeVisible();
  vi.restoreAllMocks();
  // every call is refused now, session.access included: the router forgot the session
  fakeUbus(() => new Error('denied'));
  await expect(call('test', 'after', {}, z.unknown())).rejects.toThrow('Session expired');
  expect(screen.client.getQueryCache().getAll()).toHaveLength(0);
});
