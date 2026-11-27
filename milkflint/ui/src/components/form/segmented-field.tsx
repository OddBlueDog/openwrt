import type { ReactElement } from 'react';
import { Segmented } from '@/components/ui/segmented';
import type { FieldOf } from './field-of';
import { type FieldText, FormField } from './form-field';

/** A row of choices (a radio group) bound to a text value. */
export function SegmentedField<V extends string>({
  field,
  options,
  disabled,
  size,
  ...text
}: FieldText & {
  field: FieldOf<V>;
  options: readonly { value: V; label: string; title?: string }[];
  disabled?: boolean | undefined;
  size?: 'sm' | 'xs' | undefined;
}): ReactElement {
  return (
    <FormField field={field} {...text}>
      {(control) => (
        <Segmented
          {...control}
          label={text.label}
          value={field.state.value}
          options={options}
          disabled={disabled ?? false}
          size={size ?? 'sm'}
          onChange={(v) => {
            field.handleChange(v);
            field.handleBlur();
          }}
        />
      )}
    </FormField>
  );
}
