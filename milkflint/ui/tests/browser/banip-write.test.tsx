// banIP's writes (useBanipWrite): once one went through, the page's reads are
// asked again; one that fails asks nothing again and hands back its error.
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { banipQueries, useBanipWrite } from '@/features/banip/queries';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

const reads = vi.hoisted(() => ({ config: 0 }));

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      if (`${object} ${method}` === 'milkflint.banip config') {
        reads.config++;
        return schema.parse({ installed: true, enabled: false });
      }
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

let write: ReturnType<typeof useBanipWrite> | undefined;

function Harness(): ReactElement {
  const config = useQuery(banipQueries.config());
  write = useBanipWrite();
  return <p>{config.data === undefined ? 'reading' : 'read'}</p>;
}

afterEach(async () => {
  await cleanup();
  reads.config = 0;
});

test('a write that went through asks the config again', async () => {
  const screen = await renderWithProviders(<Harness />);
  await expect.element(screen.getByText('read')).toBeVisible();
  expect(reads.config).toBe(1);
  await write?.mutateAsync(() => Promise.resolve('ok'));
  expect(reads.config).toBe(2);
});

test('a write that fails asks nothing again and hands back its error', async () => {
  const screen = await renderWithProviders(<Harness />);
  await expect.element(screen.getByText('read')).toBeVisible();
  await expect(write?.mutateAsync(() => Promise.reject(new Error('banIP said no')))).rejects.toThrow('banIP said no');
  expect(reads.config).toBe(1);
});
