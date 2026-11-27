// The form kit in a real browser: each field is found by its label, shows no
// error on a pristine form, wires aria-invalid and aria-describedby to its
// error once there is one, and changes the form's value; NumberField keeps
// NumberInput's held-until-left behaviour; stacked fields work in a sheet's
// layout too.
import type { ReactElement } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';
import { NumberField, SegmentedField, SelectField, SwitchField, TextField } from '@/components/form';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { renderWithProviders } from './render';

const schema = z.object({
  name: z.string().min(1, 'Enter a name.'),
  on: z.boolean().refine((v) => v, 'Must be on.'),
  count: z.number().max(8, 'At most 8.'),
  mode: z.enum(['fast', 'slow']).refine((v) => v === 'fast', 'Fast only.'),
  view: z.enum(['list', 'grid']).refine((v) => v === 'list', 'List only.'),
});
type Form = z.infer<typeof schema>;
const saved: Form = { name: 'a', on: true, count: 5, mode: 'fast', view: 'list' };

function Kit({ layout }: { layout?: 'row' | 'stacked' }): ReactElement {
  const { form } = useSettingsForm({ schema, saved, onSave: () => undefined });
  const values = useFormValues(form);
  return (
    <TooltipProvider>
      <form.Field name="name">
        {(field) => <TextField field={field} label="Name" hint="What it's called." layout={layout} />}
      </form.Field>
      <form.Field name="on">{(field) => <SwitchField field={field} label="On" layout={layout} />}</form.Field>
      <form.Field name="count">
        {(field) => <NumberField field={field} label="Count" min={1} max={10} integer layout={layout} />}
      </form.Field>
      <form.Field name="mode">
        {(field) => (
          <SelectField
            field={field}
            label="Mode"
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'slow', label: 'Slow' },
            ]}
            layout={layout}
          />
        )}
      </form.Field>
      <form.Field name="view">
        {(field) => (
          <SegmentedField
            field={field}
            label="View"
            options={[
              { value: 'list', label: 'List' },
              { value: 'grid', label: 'Grid' },
            ]}
            layout={layout}
          />
        )}
      </form.Field>
      <output aria-label="values">{JSON.stringify(values)}</output>
    </TooltipProvider>
  );
}

// what the form holds, valid or not (the form's own schema would refuse the invalid values these tests make)
const shape = z.object({ name: z.string(), on: z.boolean(), count: z.number(), mode: z.string(), view: z.string() });
const values = (): z.infer<typeof shape> =>
  shape.parse(JSON.parse(document.querySelector('output[aria-label="values"]')?.textContent ?? '{}'));

/** The control's error: what its aria-describedby points at, once it says it's invalid. */
async function errorOf(control: Element | null): Promise<string | undefined> {
  await expect.poll(() => control?.getAttribute('aria-invalid')).toBe('true');
  const id = control?.getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? undefined;
}

afterEach(async () => {
  await cleanup();
});

test('every field is found by its label, and a pristine form shows no error', async () => {
  const screen = await renderWithProviders(<Kit />);
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('a');
  await expect.element(screen.getByRole('switch', { name: 'On' })).toBeChecked();
  await expect.element(screen.getByRole('spinbutton', { name: 'Count' })).toHaveValue(5);
  await expect.element(screen.getByRole('combobox', { name: 'Mode' })).toHaveTextContent('Fast');
  await expect.element(screen.getByRole('radiogroup', { name: 'View' })).toBeVisible();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
});

test('TextField: typing changes the value; an error is wired to the box', async () => {
  const screen = await renderWithProviders(<Kit />);
  const box = screen.getByRole('textbox', { name: 'Name' });
  await box.fill('router');
  expect(values().name).toBe('router');
  await box.fill('');
  expect(await errorOf(box.element())).toBe('Enter a name.');
});

test('SwitchField: toggling changes the value; an error is wired to the switch', async () => {
  const screen = await renderWithProviders(<Kit />);
  const on = screen.getByRole('switch', { name: 'On' });
  await on.click();
  expect(values().on).toBe(false);
  expect(await errorOf(on.element())).toBe('Must be on.');
});

test('NumberField: a value in range goes in at once; one out of range is held until the box is left', async () => {
  const screen = await renderWithProviders(<Kit />);
  const count = screen.getByRole('spinbutton', { name: 'Count' });
  await count.fill('9');
  expect(values().count).toBe(9);
  expect(await errorOf(count.element())).toBe('At most 8.');
  await count.fill('20');
  // held: the form keeps 9, the box says the limits
  expect(values().count).toBe(9);
  await expect.element(screen.getByText('1 to 10')).toBeVisible();
  await userEvent.keyboard('{Tab}');
  await expect.poll(() => values().count).toBe(10);
});

test('SelectField: a pick changes the value; an error is wired to the trigger', async () => {
  const screen = await renderWithProviders(<Kit />);
  const mode = screen.getByRole('combobox', { name: 'Mode' });
  await mode.click();
  await screen.getByRole('option', { name: 'Slow' }).click();
  await expect.poll(() => values().mode).toBe('slow');
  expect(await errorOf(mode.element())).toBe('Fast only.');
});

test('SegmentedField: a choice changes the value; an error is wired to the group', async () => {
  const screen = await renderWithProviders(<Kit />);
  await screen.getByRole('radio', { name: 'Grid' }).click();
  expect(values().view).toBe('grid');
  expect(await errorOf(screen.getByRole('radiogroup', { name: 'View' }).element())).toBe('List only.');
});

test('stacked: the label above, the error in place of the hint', async () => {
  const screen = await renderWithProviders(<Kit layout="stacked" />);
  await expect.element(screen.getByText("What it's called.")).toBeVisible();
  const box = screen.getByRole('textbox', { name: 'Name' });
  await box.fill('');
  expect(await errorOf(box.element())).toBe('Enter a name.');
  expect(screen.getByText("What it's called.").elements()).toHaveLength(0);
});
