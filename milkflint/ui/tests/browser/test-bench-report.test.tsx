// A finished run's report, its tables on DataTable: phase by phase in groups,
// the DNS tables, the device-to-device matrix with its "What happened"
// dialog, and each device's timing; cards when narrow.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { RunReport } from '@/features/test-bench/run-report';
import { fixture } from '../test-bench-fixture';
import { renderWithProviders } from './render';

afterEach(cleanup);

// each body row's first cell (a group's heading row has none)
const bodyRows = (table: Element): string[] => [...table.querySelectorAll('tbody td:first-child')].map((td) => td.textContent);

/** The fixture's run with a device-to-device phase whose pair found no path. */
function run(): ReturnType<typeof fixture> {
  const data = fixture();
  data.meta.schedule.phases = [
    ...data.meta.schedule.phases,
    { kind: 'd2d', start: 20_000, dur: 6_000, roles: { m1: 'a', m2: 'b' }, pair: ['m1', 'm2'], dir: 'ab' },
  ];
  return data;
}

test('the report’s tables when wide: phases in groups, DNS, the matrix and timing', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 1100 }}>
      <RunReport data={run()} />
    </div>,
  );
  const phases = screen.getByRole('table', { name: 'Phase by phase' });
  await expect.element(phases).toBeVisible();
  expect(phases.element().querySelectorAll('th[scope="colgroup"]')).toHaveLength(4);
  expect(bodyRows(phases.element())).toEqual(['Mac', 'PC', 'Mac', 'PC', 'Mac', 'PC', 'Mac', 'PC']);
  await expect.element(phases.getByRole('columnheader', { name: 'To its peers' })).toBeVisible();

  const lookups = screen.getByRole('table', { name: 'The router’s own lookups' });
  await expect.element(lookups.getByRole('columnheader', { name: 'Encrypted DNS alone' })).toBeVisible();
  expect(bodyRows(lookups.element())).toEqual(['google.com']);
  const loads = screen.getByRole('table', { name: 'Each device’s page loads' });
  await expect.element(loads.getByRole('columnheader', { name: 'PC' })).toBeVisible();
  expect(bodyRows(loads.element())).toEqual(['Typical site', 'google.com']);

  const matrix = screen.getByRole('table', { name: 'Device to device' });
  expect(bodyRows(matrix.element())).toEqual(['Mac', 'PC']);
  expect(matrix.getByText('No direct path').elements()).toHaveLength(2);
  await matrix.getByRole('button', { name: 'What happened' }).first().click();
  await expect.element(screen.getByRole('dialog', { name: 'No direct path: Mac and PC' })).toBeVisible();
  await userEvent.keyboard('{Escape}');

  const timing = screen.getByRole('table', { name: 'Each device’s timing' });
  expect(bodyRows(timing.element())).toEqual([expect.stringMatching(/^Mac/), expect.stringMatching(/^PC/)]);
});

test('the report’s tables when narrow: cards, a phase heading over its devices, a pair each in the matrix', async () => {
  const screen = await renderWithProviders(
    <div style={{ width: 360 }}>
      <RunReport data={run()} />
    </div>,
  );
  expect(screen.getByRole('table').elements()).toHaveLength(0);
  const phases = document.querySelectorAll('section[aria-label^="Phase by phase: "]');
  expect(phases).toHaveLength(4);
  expect(phases[0]?.querySelectorAll('li')).toHaveLength(2);
  const loads = screen.getByRole('list', { name: 'Each device’s page loads' });
  const cards = loads.getByRole('listitem').elements();
  expect(cards[0]?.textContent).toContain('Typical site');
  expect(cards[0]?.textContent).toContain('PC:');
  const matrix = screen.getByRole('list', { name: 'Device to device' });
  expect(matrix.getByRole('listitem').first().element().textContent).toMatch(/^Mac to PC No direct path/);
  await matrix.getByRole('button', { name: 'What happened' }).first().click();
  await expect.element(screen.getByRole('dialog', { name: 'No direct path: Mac and PC' })).toBeVisible();
});
