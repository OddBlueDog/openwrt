// useSettingsForm's hard rule in a real browser: what the router sends back
// never overwrites what the user is typing, a save that comes back leaves
// the form pristine, Discard goes back; and the save bar and errors.
import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { z } from 'zod';
import { FormSaveBar } from '@/components/form/form-save-bar';
import { firstError } from '@/lib/form/errors';
import { type SettingsFormApi, useSettingsForm } from '@/lib/form/use-settings-form';
import { renderWithProviders } from './render';

const schema = z
  .object({
    name: z.string().min(1, 'Enter a name.'),
    port: z.string().regex(/^\d+$/, 'Enter a number.'),
  })
  .superRefine((f, ctx) => {
    if (f.name === 'web' && f.port !== '80') ctx.addIssue({ code: 'custom', path: ['name'], message: 'web runs on port 80.' });
  });
type Form = z.infer<typeof schema>;

function TextBox({ form, name, label }: { form: SettingsFormApi<Form>; name: 'name' | 'port'; label: string }): ReactElement {
  return (
    <form.Field name={name}>
      {(field) => {
        const error = firstError(field.state.meta.errors);
        return (
          <p>
            <label>
              {label}
              <input
                data-form={form.formId}
                aria-invalid={error !== undefined}
                value={field.state.value}
                onChange={(e) => {
                  field.handleChange(e.target.value);
                }}
                onBlur={field.handleBlur}
              />
            </label>
            {error !== undefined && <span>{error}</span>}
          </p>
        );
      }}
    </form.Field>
  );
}

function Harness({ saved, onSave }: { saved: Form; onSave: (v: Form) => unknown }): ReactElement {
  const settings = useSettingsForm({ schema, saved, onSave });
  return (
    <>
      <TextBox form={settings.form} name="name" label="Name" />
      <TextBox form={settings.form} name="port" label="Port" />
      <output>{settings.dirty ? 'dirty' : 'pristine'}</output>
      <FormSaveBar settings={settings} busy={false} />
    </>
  );
}

const value = (label: string): string => {
  const input = [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith(label))?.querySelector('input');
  return input?.value ?? '';
};

afterEach(async () => {
  await cleanup();
});

test('pristine form takes new saved data and stays pristine', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('ssh');
  await screen.rerender(<Harness saved={{ name: 'sftp', port: '2222' }} onSave={onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('sftp');
  expect(value('Port')).toBe('2222');
  await expect.element(screen.getByText('pristine')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
});

test('a dirty field keeps what was typed when saved changes; the other field updates', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('2200');
  await screen.rerender(<Harness saved={{ name: 'sftp', port: '23' }} onSave={onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('sftp');
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('2200');
  await expect.element(screen.getByText('dirty')).toBeVisible();
  // and a second refresh still keeps it
  await screen.rerender(<Harness saved={{ name: 'sftp', port: '24' }} onSave={onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('2200');
});

test('after saved becomes equal to the form, it is not dirty', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('2200');
  await expect.element(screen.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  await screen.rerender(<Harness saved={{ name: 'ssh', port: '2200' }} onSave={onSave} />);
  await expect.element(screen.getByText('pristine')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
  // pristine for real: the next refresh is taken whole
  await screen.rerender(<Harness saved={{ name: 'ssh', port: '2201' }} onSave={onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('2201');
});

test('discard returns to saved', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('x');
  await expect.element(screen.getByText('Enter a number.')).toBeVisible();
  await screen.getByRole('button', { name: 'Discard' }).click();
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('22');
  await expect.element(screen.getByText('pristine')).toBeVisible();
  expect(screen.getByText('Enter a number.').elements()).toHaveLength(0);
});

test('a cross-field error shows on the other field as soon as either changes', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'web', port: '80' }} onSave={onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('81');
  await expect.element(screen.getByText('web runs on port 80.')).toBeVisible();
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
  await screen.getByRole('textbox', { name: 'Port' }).fill('80');
  await vi.waitFor(() => {
    expect(screen.getByText('web runs on port 80.').elements()).toHaveLength(0);
  });
});

test('FormSaveBar is hidden while pristine, shown while dirty, and Save is disabled while a field has an error', async () => {
  const onSave = vi.fn();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={onSave} />);
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
  await screen.getByRole('textbox', { name: 'Port' }).fill('2200');
  await expect.element(screen.getByRole('button', { name: 'Save & apply' })).toBeEnabled();
  await screen.getByRole('textbox', { name: 'Port' }).fill('22x');
  await expect.element(screen.getByRole('button', { name: 'Save & apply' })).toBeDisabled();
  await expect.element(screen.getByText('Fix the highlighted fields to save.')).toBeVisible();
  await screen.getByRole('textbox', { name: 'Port' }).fill('2200');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(onSave).toHaveBeenCalledWith({ name: 'ssh', port: '2200' });
  });
});

test('a save attempt with an untouched invalid field shows its error, focuses it, and does not save', async () => {
  const onSave = vi.fn();
  // saved by hand elsewhere (LuCI): a name this page wouldn't accept
  const screen = await renderWithProviders(<Harness saved={{ name: '', port: '22' }} onSave={onSave} />);
  expect(screen.getByText('Enter a name.').elements()).toHaveLength(0);
  await screen.getByRole('textbox', { name: 'Port' }).fill('2200');
  // a change validates the whole form: the name's error shows at once, so Save is disabled
  await expect.element(screen.getByText('Enter a name.')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Save & apply' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

test('save() on a form whose errors aren’t showing yet shows them, focuses the first, and does not save', async () => {
  const onSave = vi.fn();
  let save: (() => void) | undefined;
  function Saver(): ReactElement {
    const settings = useSettingsForm({ schema, saved: { name: '', port: 'x' }, onSave });
    save = settings.save;
    return (
      <>
        <TextBox form={settings.form} name="name" label="Name" />
        <TextBox form={settings.form} name="port" label="Port" />
      </>
    );
  }
  const screen = await renderWithProviders(<Saver />);
  save?.();
  await expect.element(screen.getByText('Enter a name.')).toBeVisible();
  await expect.element(screen.getByText('Enter a number.')).toBeVisible();
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }).element());
  });
  expect(onSave).not.toHaveBeenCalled();
});

/** A save as useApply's apply ends it, resolved by the test when it likes. */
function pendingSave(): { onSave: (v: Form) => Promise<unknown>; end: (state: unknown) => void; values: Form[] } {
  const values: Form[] = [];
  let end: (state: unknown) => void = () => undefined;
  const onSave = (v: Form): Promise<unknown> => {
    values.push(v);
    return new Promise((resolve) => {
      end = resolve;
    });
  };
  return {
    onSave,
    end: (state) => {
      end(state);
    },
    values,
  };
}

const done = { phase: 'done', nothingChanged: false };

test('a save the router stores otherwise than typed (0080 as 80) ends pristine with what the router has', async () => {
  const save = pendingSave();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={save.onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('0080');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(save.values).toEqual([{ name: 'ssh', port: '0080' }]);
  });
  save.end(done);
  // the reads after the save come back once it's done
  await screen.rerender(<Harness saved={{ name: 'ssh', port: '80' }} onSave={save.onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('80');
  await expect.element(screen.getByText('pristine')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Unsaved changes' }).elements()).toHaveLength(0);
});

test('the same when the reads after the save come back before it is done', async () => {
  const save = pendingSave();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={save.onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('0080');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(save.values).toHaveLength(1);
  });
  await screen.rerender(<Harness saved={{ name: 'ssh', port: '80' }} onSave={save.onSave} />);
  save.end(done);
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('80');
  await expect.element(screen.getByText('pristine')).toBeVisible();
});

test('a save with nothing to write (the router has 0022 as 22 already) goes back to what the router has', async () => {
  const save = pendingSave();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={save.onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('0022');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(save.values).toHaveLength(1);
  });
  save.end({ phase: 'done', nothingChanged: true });
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('22');
  await expect.element(screen.getByText('pristine')).toBeVisible();
});

test('a save that failed keeps what was typed, through a later refresh too', async () => {
  const save = pendingSave();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={save.onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('0080');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(save.values).toHaveLength(1);
  });
  save.end({ phase: 'failed', message: 'The router is not responding' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await screen.rerender(<Harness saved={{ name: 'sftp', port: '22' }} onSave={save.onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('sftp');
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('0080');
  await expect.element(screen.getByText('dirty')).toBeVisible();
});

test('typing again while a save is on its way: the new typing stays when the save comes back', async () => {
  const save = pendingSave();
  const screen = await renderWithProviders(<Harness saved={{ name: 'ssh', port: '22' }} onSave={save.onSave} />);
  await screen.getByRole('textbox', { name: 'Port' }).fill('0080');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(save.values).toHaveLength(1);
  });
  await screen.getByRole('textbox', { name: 'Port' }).fill('0081');
  save.end(done);
  await screen.rerender(<Harness saved={{ name: 'ssh', port: '80' }} onSave={save.onSave} />);
  await expect.element(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('0081');
  await expect.element(screen.getByText('dirty')).toBeVisible();
});
