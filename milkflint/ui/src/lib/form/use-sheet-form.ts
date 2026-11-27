// A sheet's form: useSettingsForm for an editor that opens on one item and
// closes once its save went through. `submit` applies the values and gives
// the failure's message when that didn't go through (the sheet then stays
// open showing it), undefined when it did (the caller closes the sheet).
import { useSelector } from '@tanstack/react-form';
import { useState } from 'react';
import { type FormSchema, type SettingsForm, useFormValues, useSettingsForm } from './use-settings-form';

export interface SheetForm<T extends object> {
  settings: SettingsForm<T>;
  /** the form's values, kept current */
  values: T;
  /** why the last save didn't go through; cleared by the next save */
  failed: string | undefined;
  /** a save is on its way */
  submitting: boolean;
}

export function useSheetForm<T extends object>({
  schema,
  saved,
  submit,
}: {
  schema: FormSchema<T>;
  /** what the sheet opened with */
  saved: T;
  submit: (values: T) => Promise<string | undefined>;
}): SheetForm<T> {
  const [failed, setFailed] = useState<string>();
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: async (values) => {
      setFailed(undefined);
      setFailed(await submit(values));
    },
  });
  const values = useFormValues(settings.form);
  const submitting = useSelector(settings.form.store, (s) => s.isSubmitting);
  return { settings, values, failed, submitting };
}
