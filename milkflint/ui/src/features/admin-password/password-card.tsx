// The admin (root) password: set, or changed, for these pages, LuCI and
// SSH's password logins. A fresh install has none.
import { LoaderCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { TextField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import type { ApplyState } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import type { AdminPassword } from '@/lib/session';
import { errorMessage } from '@/lib/utils';
import { EMPTY_PASSWORD, passwordFormSchema } from './model';
import { useSetPassword } from './queries';

export function PasswordCard({
  password,
  where,
  onResult,
}: {
  password: AdminPassword;
  /** Where it's asked for: "here, in LuCI and over SSH". */
  where: string;
  onResult: (s: ApplyState) => void;
}): ReactElement {
  const change = useSetPassword();
  const settings = useSettingsForm({
    schema: passwordFormSchema,
    saved: EMPTY_PASSWORD,
    onSave: async ({ pw }) => {
      onResult({ phase: 'applying' });
      try {
        await change.mutateAsync(pw);
        settings.discard();
        onResult({ phase: 'done', nothingChanged: false, note: `Use it the next time you sign in ${where}.` });
      } catch (err) {
        onResult({ phase: 'failed', message: errorMessage(err) });
      }
    },
  });
  const { form } = settings;
  const { pw, again } = useFormValues(form);
  const busy = change.isPending;
  const none = password === 'none';

  return (
    <Card>
      <CardHeading
        title={none ? 'Set the admin password' : 'Change the admin password'}
        description={`The root account’s password, for signing in ${where}. A few random words work well.`}
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length >= 8 && again === pw && !busy) settings.save();
        }}
      >
        <CardContent className="divide-y border-t">
          <form.Field
            name="pw"
            listeners={{
              onChange: () => {
                onResult({ phase: 'idle' });
              },
            }}
          >
            {(field) => (
              <TextField
                field={field}
                id="pw-new"
                label="New password"
                hint="At least 8 characters."
                showError={pw !== ''}
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.Field>
          <form.Field name="again">
            {(field) => (
              <TextField
                field={field}
                id="pw-again"
                label="Type it again"
                showError={again !== ''}
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pw.length < 8 || again !== pw || busy}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            {none ? 'Set password' : 'Change password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
