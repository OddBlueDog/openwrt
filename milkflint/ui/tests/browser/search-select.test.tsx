// SearchSelect in a real browser: a choice made with the mouse closes the
// list but leaves the focus in the box, and a click on the box (its arrows)
// opens the list again, without clicking away first.
import { type ReactElement, useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { SearchSelect } from '@/components/search-select';
import { renderWithProviders } from './render';

const options = [
  { value: 'a', label: 'Laptop' },
  { value: 'b', label: 'Phone' },
  { value: 'c', label: 'Tablet' },
];

function Picker(): ReactElement {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="pick">Device</label>
      <SearchSelect id="pick" options={options} value={value} onChange={setValue} placeholder="Add a device…" />
    </>
  );
}

afterEach(async () => {
  await cleanup();
});

test('after a choice made with the mouse, a click on the box opens the list again', async () => {
  const screen = await renderWithProviders(<Picker />);
  const box = screen.getByRole('combobox', { name: 'Device' });
  await box.click();
  await expect.element(screen.getByRole('listbox')).toBeVisible();
  await screen.getByRole('option', { name: 'Phone' }).click();
  await expect.element(box).toHaveAttribute('aria-expanded', 'false');
  await expect.element(box).toHaveValue('Phone');
  expect(document.activeElement).toBe(box.element());

  await box.click();
  await expect.element(box).toHaveAttribute('aria-expanded', 'true');
  await expect.element(screen.getByRole('option', { name: 'Tablet' })).toBeVisible();
});

test('the arrow keys open it again after a choice too', async () => {
  const screen = await renderWithProviders(<Picker />);
  const box = screen.getByRole('combobox', { name: 'Device' });
  await box.click();
  await screen.getByRole('option', { name: 'Laptop' }).click();
  await expect.element(box).toHaveAttribute('aria-expanded', 'false');
  box.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await expect.element(box).toHaveAttribute('aria-expanded', 'true');
});
