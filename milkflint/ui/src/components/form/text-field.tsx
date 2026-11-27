import type { ComponentProps, ReactElement } from 'react';
import { Input } from '@/components/ui/input';
import type { FieldOf } from './field-of';
import { type FieldText, FormField } from './form-field';

/** A text box bound to a text value. */
export function TextField({
  field,
  label,
  hint,
  why,
  status,
  id,
  layout,
  showError,
  trim = false,
  ...input
}: FieldText & {
  field: FieldOf<string>;
  /** drop spaces typed or pasted around the value (an address, a number) */
  trim?: boolean | undefined;
} & Omit<
    ComponentProps<'input'>,
    'id' | 'name' | 'value' | 'onChange' | 'onBlur' | 'aria-invalid' | 'aria-describedby'
  >): ReactElement {
  return (
    <FormField field={field} label={label} hint={hint} why={why} status={status} id={id} layout={layout} showError={showError}>
      {(control) => (
        <Input
          {...input}
          {...control}
          name={field.name}
          value={field.state.value}
          onChange={(e) => {
            field.handleChange(trim ? e.target.value.trim() : e.target.value);
          }}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}
