// The shared number box keeps what is typed: a decimal on its way ("0." to "0.5") isn't overwritten by the
// parent's echo, and a value changed from outside replaces the text.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { NumberInput } from '@/components/number-input';
import { renderWithProviders } from './render';

const seen: number[] = [];

function Harness({ min, max }: { min?: number; max?: number }): React.ReactElement {
  const [v, setV] = useState(0);
  return (
    <div>
      <label htmlFor="n">Level</label>
      <NumberInput
        id="n"
        value={v}
        step={0.1}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        onChange={(x) => {
          seen.push(x);
          setV(x);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setV(3);
        }}
      >
        Set three
      </button>
    </div>
  );
}

afterEach(async () => {
  await cleanup();
  seen.length = 0;
});

test('a decimal can be typed into an unbounded box', async () => {
  await renderWithProviders(<Harness />);
  const box = page.getByLabelText('Level');
  await userEvent.clear(box);
  await userEvent.type(box, '0.5');
  await expect.element(box).toHaveValue(0.5);
  expect(seen.at(-1)).toBe(0.5);
});

test('a value from outside replaces the text', async () => {
  await renderWithProviders(<Harness />);
  const box = page.getByLabelText('Level');
  await userEvent.clear(box);
  await userEvent.type(box, '7');
  await page.getByRole('button', { name: 'Set three' }).click();
  await expect.element(box).toHaveValue(3);
});

test('"05" typed over 0 shows what was typed', async () => {
  await renderWithProviders(<Harness />);
  const box = page.getByLabelText('Level');
  await userEvent.clear(box);
  await userEvent.type(box, '05');
  expect((box.element() as HTMLInputElement).value).toBe('05');
});

test('an out-of-range draft is flagged with the limits, and pulled in on Enter', async () => {
  await renderWithProviders(<Harness min={10} max={100} />);
  const box = page.getByLabelText('Level');
  await userEvent.clear(box);
  await userEvent.type(box, '5');
  await expect.element(box).toHaveAttribute('aria-invalid', 'true');
  await expect.element(page.getByText('10 to 100')).toBeVisible();
  await userEvent.keyboard('{Enter}');
  await expect.element(box).toHaveValue(10);
  await expect.element(box).not.toHaveAttribute('aria-invalid');
});
