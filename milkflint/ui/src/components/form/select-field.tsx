import type { ReactElement, ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FieldOf } from './field-of';
import { type FieldText, FormField } from './form-field';

/** A drop-down bound to a text value; `options` are what it offers. */
export function SelectField<V extends string>({
  field,
  options,
  placeholder,
  disabled,
  triggerClassName,
  ...text
}: FieldText & {
  field: FieldOf<V>;
  options: readonly { value: V; label: ReactNode }[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  triggerClassName?: string | undefined;
}): ReactElement {
  return (
    <FormField field={field} {...text}>
      {(control) => (
        <Select
          name={field.name}
          value={field.state.value}
          disabled={disabled}
          onValueChange={(v) => {
            const picked = options.find((o) => o.value === v);
            if (picked !== undefined) field.handleChange(picked.value);
          }}
        >
          <SelectTrigger {...control} className={triggerClassName} onBlur={field.handleBlur}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
