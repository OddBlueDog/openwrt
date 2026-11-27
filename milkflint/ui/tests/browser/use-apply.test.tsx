// useApply as a mutation, against a pretend /ubus: a save refreshes what the
// page shows, two saves never interleave their staged changes, its state
// goes as pages expect, and an unreachable router fails it once, no retry.
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { z } from 'zod';
import { type ApplyState, REFRESH_WAIT_MS, useApply } from '@/hooks/use-apply';
import type { Change } from '@/lib/api/uci';
import { settingsQuery } from '@/lib/query/options';
import { call } from '@/lib/ubus';
import { renderWithProviders } from './render';

const rpcRequest = z.object({
  id: z.number(),
  params: z.tuple([z.string(), z.string(), z.string(), z.record(z.string(), z.unknown())]),
});

/** Each call as `object.method {args}`, in the order rpcd got them; a request `hang` picks is never answered. */
function fakeUbus(hang: (body: string) => boolean = () => false): string[] {
  const calls: string[] = [];
  vi.spyOn(window, 'fetch').mockImplementation((_input, init) => {
    const text = typeof init?.body === 'string' ? init.body : 'null';
    if (hang(text)) return new Promise<Response>(() => undefined);
    const body: unknown = JSON.parse(text);
    const replies = (Array.isArray(body) ? body : [body]).map((item: unknown) => {
      const { id, params } = rpcRequest.parse(item);
      const [, object, method, args] = params;
      calls.push(`${object}.${method} ${JSON.stringify(args)}`);
      const result = object === 'uci' && method === 'changes' ? [0, { changes: {} }] : object === 'test' ? [0, { n: 1 }] : [0];
      return { jsonrpc: '2.0', id, result };
    });
    // a little later, as over the network: lets a second save start while the first is on its way
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(Response.json(replies));
      }, 5),
    );
  });
  return calls;
}

let hook: ReturnType<typeof useApply> | undefined;
const states: ApplyState['phase'][] = [];

function Harness({ read = false }: { read?: boolean }): ReactElement {
  hook = useApply();
  if (states.at(-1) !== hook.state.phase) states.push(hook.state.phase);
  return (
    <>
      <span>{hook.state.phase === 'failed' ? hook.state.message : hook.state.phase}</span>
      {read && <Reader />}
    </>
  );
}

function Reader(): ReactElement {
  const q = useQuery(settingsQuery(['test', 'read'], () => call('test', 'read', {}, z.object({ n: z.number() }))));
  return <span>{q.data === undefined ? 'reading' : 'read'}</span>;
}

const change = (config: string, value: string): Change => ({ op: 'set', config, section: 's', values: { v: value } });

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  hook = undefined;
  states.length = 0;
});

test('after a successful apply a mounted settings query is read again', async () => {
  const calls = fakeUbus();
  const screen = await renderWithProviders(<Harness read />);
  await expect.element(screen.getByText('read')).toBeVisible();
  await hook?.apply([change('system', 'a')]);
  expect(calls.filter((c) => c.startsWith('test.read'))).toHaveLength(2);
  await expect.element(screen.getByText('done')).toBeVisible();
});

test('a save whose refresh never comes back (the router out of reach just after) is done after REFRESH_WAIT_MS', async () => {
  let reads = 0;
  // the page's first read is answered; the one after the save hangs, as a fetch to a router that's gone can
  const calls = fakeUbus((body) => body.includes('"test","read"') && (reads += 1) > 1);
  const screen = await renderWithProviders(<Harness read />);
  await expect.element(screen.getByText('read')).toBeVisible();
  const started = performance.now();
  const end = await hook?.apply([change('wireless', 'new-key')]);
  const took = performance.now() - started;
  expect(end).toEqual({ phase: 'done', nothingChanged: false, note: undefined });
  expect(took).toBeGreaterThanOrEqual(REFRESH_WAIT_MS - 50);
  expect(took).toBeLessThan(REFRESH_WAIT_MS + 1500);
  expect(reads).toBe(2);
  expect(calls.some((c) => c.startsWith('uci.apply'))).toBe(true);
  await expect.element(screen.getByText('done')).toBeVisible();
});

test('two saves started together stage one after the other', async () => {
  const calls = fakeUbus();
  await renderWithProviders(<Harness />);
  const first = hook?.apply([change('network', 'first')]);
  const second = hook?.apply([change('dhcp', 'second')]);
  await Promise.all([first, second]);
  const firstSet = calls.indexOf('uci.set {"config":"network","section":"s","values":{"v":"first"}}');
  const firstApply = calls.indexOf('uci.apply {"rollback":false}');
  const secondStart = calls.findIndex((c, i) => i > firstSet && c.startsWith('uci.changes'));
  expect(firstSet).toBeGreaterThan(-1);
  expect(secondStart).toBeGreaterThan(firstApply);
  expect(calls.filter((c) => c.startsWith('uci.changes'))).toHaveLength(2);
});

test('state goes idle, applying, done; a failure carries its message', async () => {
  fakeUbus();
  const screen = await renderWithProviders(<Harness />);
  await hook?.apply([change('system', 'a')]);
  await expect.element(screen.getByText('done')).toBeVisible();
  expect(states).toEqual(['idle', 'applying', 'done']);

  vi.restoreAllMocks();
  vi.spyOn(window, 'fetch').mockImplementation(() =>
    Promise.resolve(Response.json([{ jsonrpc: '2.0', id: 0, error: { code: -32000, message: 'Object not found' } }])),
  );
  await hook?.apply([change('system', 'b')]);
  // replies that answer no call: stage() tolerates uci.changes and uci.revert failing, not uci.set
  await expect.element(screen.getByText('uci.set: unknownError')).toBeVisible();
  expect(states.at(-1)).toBe('failed');
});

test('applyAndMove ends at the new address', async () => {
  fakeUbus();
  await renderWithProviders(<Harness />);
  await hook?.applyAndMove([change('network', '192.168.2.1')], 'http://192.168.2.1/');
  await vi.waitFor(() => {
    expect(hook?.state).toEqual({ phase: 'moved', url: 'http://192.168.2.1/' });
  });
});

test('an unreachable router fails the save after one request, without retrying', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  const screen = await renderWithProviders(<Harness />);
  // stage() tolerates uci.changes and uci.revert failing: uci.set, the third request, is the one that fails it
  await hook?.apply([change('system', 'a')]);
  await expect.element(screen.getByText('The router is not responding')).toBeVisible();
  const posts = fetch.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(fetch.mock.calls.length).toBe(posts);
  expect(posts).toBe(3);
});
