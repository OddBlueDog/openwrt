// One field of a settings form: its label, hint, "Why?", status and error,
// with the id, aria-invalid and aria-describedby wired to its control. In a
// row (a settings card) it is Field; stacked (a sheet), label above the
// control and the error in place of the hint. The kit's other fields are
// this with their control filled in; a bespoke control uses it directly.
import { ChevronDownIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { Field } from '@/components/field';
import { Label } from '@/components/ui/label';
import { firstError } from '@/lib/form/errors';
import { cn } from '@/lib/utils';
import type { FieldOf } from './field-of';

/** What every kit field takes besides its field. */
export interface FieldText {
  label: string;
  hint?: ReactNode;
  /** The longer explanation, behind "Why?". */
  why?: ReactNode;
  /** Live state, a warning, or why it can't be changed: shown in every theme (row layout). */
  status?: ReactNode;
  /** A fixed id, where a test or a link needs one; otherwise one is made. */
  id?: string | undefined;
  /** 'row' in a settings card (the default), 'stacked' in a sheet. */
  layout?: 'row' | 'stacked' | undefined;
  /** false keeps the field's error to itself for now (a sheet's empty field isn't wrong yet) */
  showError?: boolean | undefined;
}

/** The props a control spreads to be wired to its label and error. */
export interface ControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  /** Which form the control belongs to: a failed save focuses its first bad control. */
  'data-form': string;
}

function Stacked({
  id,
  label,
  hint,
  why,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  why?: ReactNode;
  error: string | undefined;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p className="text-xs text-muted-foreground">
            {hint}
            {why !== undefined && (
              <>
                {' '}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panel}
                  onClick={() => {
                    setOpen((o) => !o);
                  }}
                  className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
                >
                  Why?
                  <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
                </button>
              </>
            )}
          </p>
        )
      )}
      {why !== undefined && (
        <div id={panel} hidden={!open} className="max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          {why}
        </div>
      )}
    </div>
  );
}

export function FormField<V>({
  field,
  label,
  hint,
  why,
  status,
  id: fixedId,
  layout = 'row',
  showError = true,
  children,
}: FieldText & {
  field: FieldOf<V>;
  children: (control: ControlProps) => ReactNode;
}): ReactElement {
  const madeId = useId();
  const id = fixedId ?? madeId;
  const error = showError ? firstError(field.state.meta.errors) : undefined;
  const control = children({
    id,
    'aria-invalid': error === undefined ? undefined : true,
    'aria-describedby': error === undefined ? undefined : `${id}-error`,
    'data-form': field.form.formId,
  });
  if (layout === 'stacked') {
    return (
      <Stacked id={id} label={label} hint={hint} why={why} error={error}>
        {control}
      </Stacked>
    );
  }
  return (
    <Field id={id} label={label} hint={hint} why={why} status={status} error={error}>
      {control}
    </Field>
  );
}
