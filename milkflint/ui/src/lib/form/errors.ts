// A form schema's verdict as pages and model tests read it: one message per
// field, the first rule it fails, keyed by the field's name as TanStack Form
// writes it (`ipaddr`, `windows[0].start`).
import type { z } from 'zod';

/** A path as TanStack Form names the field: dotted keys, list positions in brackets. */
export function fieldName(path: readonly PropertyKey[]): string {
  let name = '';
  for (const segment of path) {
    if (typeof segment === 'number') name += `[${String(segment)}]`;
    else name += `${name === '' ? '' : '.'}${String(segment)}`;
  }
  return name;
}

/** Each field's first message; `{}` when the value is valid. */
export function formErrors(schema: z.ZodType, value: unknown): Partial<Record<string, string>> {
  const result = schema.safeParse(value);
  if (result.success) return {};
  const errors: Partial<Record<string, string>> = {};
  for (const issue of result.error.issues) errors[fieldName(issue.path)] ??= issue.message;
  return errors;
}

/** A field's first error message, from its meta.errors (schema issues, or plain strings). */
export function firstError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return undefined;
}
