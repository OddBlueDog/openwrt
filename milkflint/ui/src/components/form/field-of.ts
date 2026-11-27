// What a kit field needs from the field TanStack Form hands its render prop
// (`<form.Field name="x">{(field) => …}</form.Field>`), typed by the value
// the field holds: a SwitchField takes a FieldOf<boolean>, so giving it a
// text field's api is a compile error.
export interface FieldOf<V> {
  readonly name: string;
  readonly form: { readonly formId: string };
  readonly state: {
    readonly value: V;
    readonly meta: { readonly errors: readonly unknown[] };
  };
  readonly handleChange: (value: V) => void;
  readonly handleBlur: () => void;
}
