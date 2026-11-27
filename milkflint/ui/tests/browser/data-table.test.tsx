// DataTable: a table in a wide box, a card list in a narrow one (by its own
// width, not the window's), with compact and limit for Home widgets; sorting
// from the headings (and the Sort menu when narrow), groups, and Show more.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { type Column, DataTable } from '@/components/data-table';
import { renderWithProviders } from './render';

interface Row {
  name: string;
  ip: string;
  mac: string;
}
const rows: Row[] = [1, 2, 3, 4, 5].map((n) => ({
  name: `host-${String(n)}`,
  ip: `192.168.1.${String(n)}`,
  mac: `aa:bb:cc:00:00:0${String(n)}`,
}));
const columns: Column<Row>[] = [
  { label: 'Name', cell: (r) => r.name, compact: true },
  { label: 'Address', cell: (r) => r.ip, compact: true },
  { label: 'MAC', cell: (r) => r.mac },
];
// sortable: the address as people read it, a name that may be missing (last either way)
interface Item {
  name: string | undefined;
  ip: string;
}
const items: Item[] = [
  { name: 'b', ip: '192.168.1.20' },
  { name: undefined, ip: '192.168.1.3' },
  { name: 'a', ip: '192.168.1.100' },
];
const sortColumns: Column<Item>[] = [
  { label: 'Name', cell: (r) => r.name ?? 'Unnamed', sort: (r) => r.name },
  { label: 'Address', cell: (r) => r.ip, sort: (r) => r.ip, sortLabel: 'By address' },
];
const firstCells = (): string[] =>
  [...document.querySelectorAll('table tbody tr')].map((tr) => tr.querySelector('td')?.textContent ?? '');
const addresses = (): string[] =>
  [...document.querySelectorAll('table tbody tr')].map((tr) => tr.querySelectorAll('td')[1]?.textContent ?? '');

afterEach(cleanup);

function box(
  width: number,
  props: { compact?: boolean; limit?: number; rows?: Row[] } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <div style={{ width }}>
      <DataTable
        label="Leases"
        columns={columns}
        rows={props.rows ?? rows}
        rowKey={(r) => r.mac}
        empty="Nothing here yet."
        compact={props.compact}
        limit={props.limit}
      />
    </div>,
  );
}

test('a table when wide', async () => {
  const screen = await box(900);
  await expect.element(screen.getByRole('table', { name: 'Leases' })).toBeVisible();
  expect(screen.getByRole('columnheader').elements()).toHaveLength(3);
  // five body rows plus the heading row
  expect(screen.getByRole('row').elements()).toHaveLength(6);
});

test('cards when narrow', async () => {
  const screen = await box(320);
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  const items = screen.getByRole('listitem').elements();
  expect(items).toHaveLength(5);
  for (const [i, li] of items.entries()) {
    expect(li.textContent).toContain(`host-${String(i + 1)}`);
    expect(li.textContent).toContain('MAC:');
  }
});

test('compact and limit', async () => {
  const screen = await box(900, { compact: true, limit: 2 });
  expect(screen.getByRole('columnheader').elements()).toHaveLength(2);
  expect(screen.getByRole('row').elements()).toHaveLength(3);
  expect(screen.getByText('MAC').elements()).toHaveLength(0);
});

test('empty', async () => {
  const screen = await box(900, { rows: [] });
  await expect.element(screen.getByText('Nothing here yet.')).toBeVisible();
  expect(screen.getByRole('table').elements()).toHaveLength(0);
});

test('the first heading lines up with the first cell, and the card list is a list for Safari', async () => {
  const wide = await box(900);
  await expect.element(wide.getByRole('columnheader', { name: 'Name' })).toHaveClass('pl-5');
  expect(wide.getByRole('columnheader', { name: 'Address' }).element().classList.contains('pl-5')).toBe(false);
  await cleanup();
  await box(360);
  expect(document.querySelector('ul[aria-label="Leases"]')?.getAttribute('role')).toBe('list');
});

test('a heading sorts: its first way, then turned round, then the order the rows came in', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 900 }}>
      <DataTable label="Hosts" columns={sortColumns} rows={items} rowKey={(r) => r.ip} empty="None" />
    </div>,
  );
  const head = screen.getByRole('columnheader', { name: 'Address' });
  await head.getByRole('button').click();
  await expect.element(head).toHaveAttribute('aria-sort', 'ascending');
  // numbers inside text as numbers: .3 before .20 before .100
  expect(addresses()).toEqual(['192.168.1.3', '192.168.1.20', '192.168.1.100']);
  await head.getByRole('button').click();
  await expect.element(head).toHaveAttribute('aria-sort', 'descending');
  expect(addresses()).toEqual(['192.168.1.100', '192.168.1.20', '192.168.1.3']);
  await head.getByRole('button').click();
  await expect.element(head).not.toHaveAttribute('aria-sort');
  expect(addresses()).toEqual(['192.168.1.20', '192.168.1.3', '192.168.1.100']);
  // a missing value is last whichever way
  const name = screen.getByRole('columnheader', { name: 'Name' });
  await name.getByRole('button').click();
  expect(firstCells()).toEqual(['a', 'b', 'Unnamed']);
  await name.getByRole('button').click();
  expect(firstCells()).toEqual(['b', 'a', 'Unnamed']);
});

test('an initial sort only turns round; compact tables and groups don’t sort', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 900 }}>
      <DataTable
        label="Hosts"
        columns={sortColumns}
        rows={items}
        rowKey={(r) => r.ip}
        empty="None"
        initialSort={{ id: 'Address', desc: true }}
      />
    </div>,
  );
  const head = screen.getByRole('columnheader', { name: 'Address' });
  await expect.element(head).toHaveAttribute('aria-sort', 'descending');
  await head.getByRole('button').click();
  await head.getByRole('button').click();
  await expect.element(head).toHaveAttribute('aria-sort', 'descending');
  await cleanup();
  const compact = await renderWithProviders(
    <div style={{ width: 900 }}>
      <DataTable
        label="Hosts"
        columns={sortColumns.map((c) => ({ ...c, compact: true }))}
        rows={items}
        rowKey={(r) => r.ip}
        empty="None"
        compact
      />
    </div>,
  );
  expect(compact.getByRole('button').elements()).toHaveLength(0);
});

test('narrow: a Sort menu and a Reverse button order the cards', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 360 }}>
      <DataTable
        label="Hosts"
        columns={sortColumns}
        rows={items}
        rowKey={(r) => r.ip}
        empty="None"
        defaultOrder="As the router sent them"
      />
    </div>,
  );
  const cardIps = (): string[] =>
    [...document.querySelectorAll('ul[aria-label="Hosts"] li')].map((li) => /Address:(\S+)/.exec(li.textContent)?.[1] ?? '');
  await expect.element(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('As the router sent them');
  await screen.getByRole('combobox', { name: 'Sort' }).click();
  await screen.getByRole('option', { name: 'By address' }).click();
  expect(cardIps()).toEqual(['192.168.1.3', '192.168.1.20', '192.168.1.100']);
  await screen.getByRole('button', { name: 'Reverse the order' }).click();
  expect(cardIps()).toEqual(['192.168.1.100', '192.168.1.20', '192.168.1.3']);
  await expect.element(screen.getByRole('button', { name: 'Reverse the order' })).toHaveAttribute('aria-pressed', 'true');
});

test('groups: a heading row each, in their order, an empty group’s note', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 900 }}>
      <DataTable
        label="Rules"
        columns={sortColumns}
        groups={[
          { key: 'lan', header: 'From LAN', rows: items.slice(0, 2) },
          { key: 'wan', header: 'From the internet', rows: [], empty: 'No rules here.' },
        ]}
        rowKey={(r) => r.ip}
        empty="None"
      />
    </div>,
  );
  expect(screen.getByRole('table').element().querySelectorAll('tbody')).toHaveLength(2);
  expect([...document.querySelectorAll('th[scope="colgroup"]')].map((th) => th.textContent)).toEqual([
    'From LAN',
    'From the internet',
  ]);
  await expect.element(screen.getByRole('table').getByText('No rules here.')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Address' }).getByRole('button').elements()).toHaveLength(0);
});

test('pageSize: that many rows, then Show more', async () => {
  const many: Row[] = Array.from({ length: 7 }, (_, n) => ({
    name: `h${String(n)}`,
    ip: `10.0.0.${String(n)}`,
    mac: `m${String(n)}`,
  }));
  const screen = await renderWithProviders(
    <div style={{ width: 900 }}>
      <DataTable label="Hosts" columns={columns} rows={many} rowKey={(r) => r.mac} empty="None" pageSize={3} />
    </div>,
  );
  expect(document.querySelectorAll('table tbody tr')).toHaveLength(3);
  await expect.element(screen.getByText('Showing 3 of 7.')).toBeVisible();
  await screen.getByRole('button', { name: 'Show 3 more' }).click();
  await screen.getByRole('button', { name: 'Show 1 more' }).click();
  expect(document.querySelectorAll('table tbody tr')).toHaveLength(7);
});

test('inset: the Sort menu and Show more keep to the card’s padding', async () => {
  const many: Item[] = Array.from({ length: 4 }, (_, n) => ({ name: `h${String(n)}`, ip: `10.0.0.${String(n)}` }));
  const screen = await renderWithProviders(
    <div style={{ width: 360 }}>
      <DataTable
        label="Hosts"
        columns={sortColumns}
        rows={many}
        rowKey={(r) => r.ip}
        empty="None"
        framed={false}
        inset
        pageSize={2}
      />
    </div>,
  );
  const pad = (el: Element | null): string => (el === null ? '' : getComputedStyle(el).paddingLeft);
  expect(pad(screen.getByRole('combobox', { name: 'Sort' }).element().parentElement)).toBe('20px');
  expect(pad(screen.getByRole('button', { name: 'Show 2 more' }).element().parentElement)).toBe('20px');
  // the cards themselves still reach the sides
  expect(pad(document.querySelector('ul[aria-label="Hosts"]')?.parentElement ?? null)).toBe('0px');
});

test('a sticky header stays at the top of the box that scrolls, and the rows keep their lines', async () => {
  const many: Row[] = Array.from({ length: 40 }, (_, n) => ({
    name: `h${String(n)}`,
    ip: `10.0.0.${String(n)}`,
    mac: `m${String(n)}`,
  }));
  const screen = await renderWithProviders(
    <div data-testid="box" style={{ width: 600, height: 200, overflowY: 'auto' }}>
      <DataTable
        label="Hosts"
        columns={columns}
        rows={many}
        rowKey={(r) => r.mac}
        empty="None"
        framed={false}
        cards={false}
        stickyHeader
      />
    </div>,
  );
  const box = screen.getByTestId('box').element();
  box.scrollTop = 400;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const head = screen.getByRole('columnheader', { name: 'Name' }).element().getBoundingClientRect();
  expect(Math.round(head.top)).toBe(Math.round(box.getBoundingClientRect().top));
  // the separate borders a sticky heading needs give rows none: their cells draw the lines
  const lines = [...document.querySelectorAll('tbody td:first-child')].map((td) => getComputedStyle(td).borderBottomWidth);
  expect(lines[0]).toBe('1px');
  expect(lines.at(-1)).toBe('0px');
});
