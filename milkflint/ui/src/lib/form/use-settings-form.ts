// A settings form on TanStack Form (see ARCHITECTURE.md): the saved settings
// are its defaults, its zod schema checks the whole form on each change and
// on a save, and it owns the one hard rule: what the router sends back
// never overwrites what the user is typing.
//
//   1. a pristine form takes new saved settings and stays pristine;
//   2. a touched form keeps each value the user changed, and takes the new
//      saved value for each one they didn't;
//   3. once the values equal the saved settings, it's pristine again; and
//      after a save went through, the saved settings it brings back are
//      taken whole while the values are still the ones saved, as the
//      router may store a value otherwise than it was typed (an empty box
//      for a default, a trimmed name): those would stay "unsaved" for good;
//   4. discard goes back to the saved settings, pristine.
//
// TanStack Form's useForm does 1 itself (it resets to new defaults while no
// field is touched) and leaves a touched form alone; this adds 2 and 3.
import { evaluate, useForm, useSelector } from '@tanstack/react-form';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { z } from 'zod';

/** A schema whose input and output are the form's values (no transforms in form schemas). */
export type FormSchema<T> = z.ZodType<T, T>;

/** `onSave` resolves true when the form should go back to the saved settings, if it still has the values saved. */
function useSettingsFormApi<T extends object>(schema: FormSchema<T>, saved: T, onSave: (values: T) => Promise<boolean>) {
  return useForm({
    defaultValues: saved,
    // runs on every change and again on a save
    validators: { onChange: schema },
    onSubmit: async ({ value, formApi }) => {
      const values = schema.parse(value);
      if ((await onSave(values)) && evaluate(formApi.state.values, values)) formApi.reset();
    },
    onSubmitInvalid: ({ formApi }) => {
      focusFirstInvalid(formApi.formId);
    },
  });
}

/** The TanStack Form instance a settings form is: `form.Field`, `form.store`, `form.reset`… */
export type SettingsFormApi<T extends object> = ReturnType<typeof useSettingsFormApi<T>>;

export interface SettingsForm<T extends object> {
  form: SettingsFormApi<T>;
  /** The values differ from the saved settings: the save bar shows. */
  dirty: boolean;
  /** An error is showing: Save is disabled. */
  invalid: boolean;
  /** Check everything; save when it passes, else show what's wrong and focus the first bad field. */
  save: () => void;
  /** Back to the saved settings. */
  discard: () => void;
}

/** The own keys of an object, typed as its keys. */
function keysOf<T extends object>(value: T): (keyof T)[] {
  return Object.keys(value).filter((key): key is Extract<keyof T, string> => key in value);
}

/** `current` with each top-level value that's still as it was in `before` taken from `next`. */
function keepEdits<T extends object>(current: T, before: T, next: T): T {
  const merged = { ...current };
  for (const key of keysOf(next)) {
    if (evaluate(current[key], before[key])) merged[key] = next[key];
  }
  return merged;
}

/** How a save ended, from what onSave resolved with: useApply's state, or anything else. */
function outcomeOf(result: unknown): 'failed' | 'unchanged' | 'other' {
  if (typeof result !== 'object' || result === null || !('phase' in result)) return 'other';
  if (result.phase === 'failed') return 'failed';
  if (result.phase === 'done' && 'nothingChanged' in result && result.nothingChanged === true) return 'unchanged';
  return 'other';
}

/** Focus the first field of this form that shows an error (after React has drawn it). */
function focusFirstInvalid(formId: string): void {
  setTimeout(() => {
    const bad = document.querySelector<HTMLElement>(`[data-form="${CSS.escape(formId)}"][aria-invalid="true"]`);
    bad?.focus();
  }, 0);
}

export function useSettingsForm<T extends object>({
  schema,
  saved,
  onSave,
}: {
  schema: FormSchema<T>;
  saved: T;
  /**
   * Called with the checked values; the form stays as it is until the saved
   * settings come back. Resolving with useApply's state tells the form how
   * the save ended (failed: the edits stay; nothing changed: back to saved).
   */
  onSave: (values: T) => unknown;
}): SettingsForm<T> {
  // the values of a save on its way or gone through, until the saved settings it wrote come back
  const submitted = useRef<T | null>(null);
  const form = useSettingsFormApi(schema, saved, async (values) => {
    submitted.current = values;
    let outcome: ReturnType<typeof outcomeOf>;
    try {
      outcome = outcomeOf(await onSave(values));
    } catch (err) {
      submitted.current = null;
      throw err;
    }
    // the saved settings came back while it was on its way (the effect below took them)
    if (submitted.current !== values) return false;
    if (outcome === 'other') return false;
    submitted.current = null;
    // nothing to write: the router has these already, as it stores them
    return outcome === 'unchanged';
  });

  // after useForm's own update (declared before this): rules 2 and 3
  const previous = useRef(saved);
  useLayoutEffect(() => {
    const before = previous.current;
    if (evaluate(before, saved)) return;
    previous.current = saved;
    const justSaved = submitted.current;
    submitted.current = null;
    const { values, isTouched } = form.state;
    if (!isTouched) return; // rule 1: useForm already took the new values
    if (justSaved !== null && evaluate(values, justSaved)) {
      form.reset(); // rule 3: what was saved, as the router now has it
      return;
    }
    const merged = keepEdits(values, before, saved);
    if (evaluate(merged, saved)) form.reset();
    else if (!evaluate(merged, values)) form.baseStore.setState((state) => ({ ...state, values: merged }));
  }, [form, saved]);

  const dirty = useSelector(form.store, (state) => !evaluate(state.values, saved));
  const invalid = useSelector(form.store, (state) => !state.isValid);
  const save = useCallback(() => {
    void form.handleSubmit();
  }, [form]);
  const discard = useCallback(() => {
    form.reset();
  }, [form]);
  return { form, dirty, invalid, save, discard };
}

/** The whole form's values, kept current: for what a page works out from them (a range, a warning). */
export function useFormValues<T extends object>(form: SettingsFormApi<T>): T {
  return useSelector(form.store, (state) => state.values);
}
