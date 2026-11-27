import type { ComponentProps, ReactElement } from 'react';
import { NumberInput } from '@/components/number-input';
import type { FieldOf } from './field-of';
import { type FieldText, FormField } from './form-field';

/** A number box bound to a number value: NumberInput's behaviour (a value out of its limits is held until the box is left). */
export function NumberField({
  field,
  label,
  hint,
  why,
  status,
  id,
  layout,
  showError,
  ...input
}: FieldText & { field: FieldOf<number> } & Omit<
    ComponentProps<typeof NumberInput>,
    'id' | 'name' | 'value' | 'onChange' | 'onBlur' | 'aria-invalid' | 'aria-describedby'
  >): ReactElement {
  return (
    <FormField field={field} label={label} hint={hint} why={why} status={status} id={id} layout={layout} showError={showError}>
      {(control) => (
        <NumberInput
          {...input}
          {...control}
          name={field.name}
          value={field.state.value}
          onChange={(v) => {
            field.handleChange(v);
          }}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}
