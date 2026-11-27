import type { ReactElement } from 'react';
import { Switch } from '@/components/ui/switch';
import type { FieldOf } from './field-of';
import { type FieldText, FormField } from './form-field';

/** A switch bound to a yes/no value. */
export function SwitchField({
  field,
  disabled,
  ...text
}: FieldText & { field: FieldOf<boolean>; disabled?: boolean | undefined }): ReactElement {
  return (
    <FormField field={field} {...text}>
      {(control) => (
        <Switch
          {...control}
          name={field.name}
          checked={field.state.value}
          disabled={disabled}
          onCheckedChange={(checked) => {
            field.handleChange(checked);
          }}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}
