// Typecheck only (pnpm typecheck; never run): a kit field takes only a field
// of the value it binds, so a switch on a text field doesn't compile.
import type { ReactElement } from 'react';
import { z } from 'zod';
import { NumberField, SwitchField, TextField } from '@/components/form';
import { useSettingsForm } from '@/lib/form/use-settings-form';

const schema = z.object({ enabled: z.boolean(), ssid: z.string(), channel: z.number() });

export function Typed(): ReactElement {
  const { form } = useSettingsForm({ schema, saved: { enabled: true, ssid: 'home', channel: 36 }, onSave: () => undefined });
  return (
    <>
      <form.Field name="enabled">{(field) => <SwitchField field={field} label="On" />}</form.Field>
      <form.Field name="ssid">{(field) => <TextField field={field} label="Name" />}</form.Field>
      <form.Field name="channel">{(field) => <NumberField field={field} label="Channel" />}</form.Field>
      <form.Field name="ssid">
        {(field) => (
          // @ts-expect-error a switch can't bind a text value
          <SwitchField field={field} label="On" />
        )}
      </form.Field>
      <form.Field name="enabled">
        {(field) => (
          // @ts-expect-error a text box can't bind a yes/no value
          <TextField field={field} label="Name" />
        )}
      </form.Field>
      <form.Field name="channel">
        {(field) => (
          // @ts-expect-error a text box can't bind a number
          <TextField field={field} label="Channel" />
        )}
      </form.Field>
    </>
  );
}
