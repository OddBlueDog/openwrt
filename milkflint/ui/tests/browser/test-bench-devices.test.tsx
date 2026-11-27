// The bench's devices as a DataTable: your row stands out, each row's rename
// and actions, and an action's error in its row, wide or narrow.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import type { Member } from '@/features/test-bench/api';
import { type MemberEntry, MemberList } from '@/features/test-bench/member-card';
import { renderWithProviders } from './render';

afterEach(cleanup);

const mac: Member = { id: 'm1', name: 'Mac', ip: '192.168.1.10', seen_ms: 0, joined: 0, link: { kind: 'wired' } };
const pc: Member = { id: 'm2', name: 'PC', ip: '192.168.1.20', seen_ms: 0, joined: 0, link: { kind: 'wifi' } };
const rename = vi.fn<(name: string) => Promise<void>>(() => Promise.resolve());
const entries: MemberEntry[] = [
  { m: mac, me: true, coordinator: true, phaseLabel: undefined, actions: { rename } },
  {
    m: pc,
    me: false,
    coordinator: false,
    phaseLabel: undefined,
    actions: { makeCoordinator: () => Promise.resolve(), remove: () => Promise.reject(new Error('The router said no')) },
  },
];

test('the devices: your row stands out, a rename in place, an action’s error in its row', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 1000 }}>
      <MemberList entries={entries} />
    </div>,
  );
  const table = screen.getByRole('table', { name: 'Devices' });
  await expect.element(table).toBeVisible();
  const rows = table.element().querySelectorAll('tbody tr');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.className).toContain('bg-primary-subtle/40');
  expect(rows[1]?.className).not.toContain('bg-primary-subtle/40');

  await screen.getByRole('button', { name: 'Remove PC from the bench' }).click();
  await expect.element(table.getByText('The router said no')).toBeVisible();

  await screen.getByRole('button', { name: 'Rename Mac' }).click();
  const box = table.getByRole('textbox', { name: 'Name' });
  await userEvent.clear(box);
  await userEvent.type(box, 'Laptop');
  await table.getByRole('button', { name: 'Save the name' }).click();
  expect(rename).toHaveBeenCalledWith('Laptop');
  await expect.element(table.getByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
});

test('the devices when narrow: a card each, with labelled buttons', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 360 }}>
      <MemberList entries={entries} />
    </div>,
  );
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  const list = screen.getByRole('list', { name: 'Devices' });
  expect(list.getByRole('listitem').elements()).toHaveLength(2);
  await list.getByRole('button', { name: 'Remove' }).click();
  await expect.element(list.getByText('The router said no')).toBeVisible();
});
