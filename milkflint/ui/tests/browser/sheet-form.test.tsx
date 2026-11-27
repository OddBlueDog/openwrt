// useSheetForm: a save that fails keeps the failure until the next save; one
// that goes through hands over the checked values once; Save is held while a
// save is on its way.
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { z } from 'zod';
import { useSheetForm } from '@/lib/form/use-sheet-form';
import { renderWithProviders } from './render';

const schema = z.object({ name: z.string().min(1, 'Enter a name.') });
type Form = z.infer<typeof schema>;

function Sheet({ submit }: { submit: (v: Form) => Promise<string | undefined> }): ReactElement {
  const { settings, values, failed, submitting } = useSheetForm({ schema, saved: { name: 'web' }, submit });
  return (
    <>
      <input
        aria-label="Name"
        value={values.name}
        onChange={(e) => {
          settings.form.setFieldValue('name', e.target.value);
        }}
      />
      <button type="button" disabled={submitting} onClick={settings.save}>
        Save
      </button>
      {failed !== undefined && <p>{failed}</p>}
    </>
  );
}

afterEach(async () => {
  await cleanup();
});

test('a failed save shows why; the next one clears it and hands over the values', async () => {
  const submit = vi.fn<(v: Form) => Promise<string | undefined>>(() => Promise.resolve('The router is not responding'));
  const screen = await renderWithProviders(<Sheet submit={submit} />);
  await screen.getByRole('textbox', { name: 'Name' }).fill('ssh');
  await screen.getByRole('button', { name: 'Save' }).click();
  await expect.element(screen.getByText('The router is not responding')).toBeVisible();
  submit.mockImplementation(() => Promise.resolve(undefined));
  await screen.getByRole('button', { name: 'Save' }).click();
  await vi.waitFor(() => {
    expect(screen.getByText('The router is not responding').elements()).toHaveLength(0);
  });
  expect(submit).toHaveBeenLastCalledWith({ name: 'ssh' });
  expect(submit).toHaveBeenCalledTimes(2);
});

test('an invalid form isn’t handed over', async () => {
  const submit = vi.fn<(v: Form) => Promise<string | undefined>>(() => Promise.resolve(undefined));
  const screen = await renderWithProviders(<Sheet submit={submit} />);
  await screen.getByRole('textbox', { name: 'Name' }).fill('');
  await screen.getByRole('button', { name: 'Save' }).click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(submit).not.toHaveBeenCalled();
});
