// Signing in: MilkFlint's mark and name, the admin password, and what a new
// or reset router asks for (nothing: it has no password until one is set,
// so anyone on a cable can sign in meanwhile).
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, KeyRoundIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Logo, Wordmark } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSettingsForm } from '@/lib/form/use-settings-form';
import { UbusError, UbusStatus, UnreachableError } from '@/lib/ubus';
import { errorMessage } from '@/lib/utils';
import { loginFormSchema } from './model';
import { useLogin } from './queries';

/** Why signing in failed, in words. */
function loginError(err: unknown): string {
  // a wrong password is rpcd's answer; uhttpd's own error means rpcd
  // (its session object) isn't there to ask
  if (err instanceof UbusError && err.rpcError !== undefined)
    return "The router's login service isn't answering. Restart the router, then try again.";
  if (err instanceof UbusError && err.code === UbusStatus.permissionDenied) return 'Wrong password.';
  if (err instanceof UnreachableError) return 'The router is not responding. Check the connection.';
  return errorMessage(err);
}

export function LoginPage({ reason }: { reason: 'expired' | 'logged-out' | undefined }): ReactElement {
  const signIn = useLogin();
  const settings = useSettingsForm({
    schema: loginFormSchema,
    saved: { password: '' },
    // the session changes on success, and this page gives way to the app
    onSave: ({ password }) => signIn.mutateAsync(password).catch(() => undefined),
  });
  const { form } = settings;
  const busy = signIn.isPending;
  const error = signIn.error === null ? undefined : loginError(signIn.error);

  const described = ['password-hint', error === undefined ? undefined : 'login-error'].filter((x) => x !== undefined).join(' ');

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-3">
          <Logo className="size-10 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <Wordmark className="text-xl" />
            <span className="text-sm leading-none text-muted-foreground">Smooth under load.</span>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            settings.save();
          }}
          className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-xs"
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            {reason === 'expired' && (
              <p role="status" className="text-sm text-muted-foreground">
                Your session ended. Sign in again to carry on.
              </p>
            )}
            {reason === 'logged-out' && <p className="text-sm text-muted-foreground">You’ve signed out.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Admin password</Label>
            <form.Field name="password">
              {(field) => (
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={error !== undefined}
                  aria-describedby={described}
                />
              )}
            </form.Field>
            <p id="password-hint" className="text-xs text-muted-foreground">
              The router’s root password, the same one LuCI asks for.
            </p>
            {error !== undefined && (
              <p id="login-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <ArrowRightIcon />}
            Sign in
          </Button>
          <div className="border-t pt-4">
            <Note tone="info" icon={<KeyRoundIcon />} title="New or just reset?">
              It has no password yet: leave the box empty and sign in. Until you set one, anyone with a cable to the router can do
              the same, so set one first, on Router access under Security.
            </Note>
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-sm">
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              to="/test-bench/join/$"
              params={{ _splat: '' }}
              className="inline-flex min-h-6 items-center text-muted-foreground hover:text-foreground hover:underline"
            >
              Join a test bench
            </Link>
            <a
              href="/cgi-bin/luci/"
              className="inline-flex min-h-6 items-center text-muted-foreground hover:text-foreground hover:underline"
            >
              Advanced (LuCI)
            </a>
          </span>
          <ThemeToggle className="w-28" />
        </div>
      </main>
    </div>
  );
}
