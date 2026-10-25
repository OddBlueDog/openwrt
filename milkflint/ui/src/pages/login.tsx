import { ArrowRightIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { login } from '@/lib/session';
import { UbusError, UbusStatus, UnreachableError } from '@/lib/ubus';
import { errorMessage } from '@/lib/utils';

export function LoginPage({ reason }: { reason: 'expired' | 'logged-out' | undefined }): ReactElement {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login('root', password);
    } catch (err) {
      if (err instanceof UbusError && err.code === UbusStatus.permissionDenied) setError('Wrong password.');
      else if (err instanceof UnreachableError) setError('The router is not responding. Check the connection.');
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-11" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in to your router</h1>
          <p className="text-sm text-muted-foreground">
            Use the router&apos;s admin (root) password. A new or reset router has none yet: leave it empty.
          </p>
        </div>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs"
        >
          {reason === 'expired' && (
            <Alert variant="info">
              <AlertDescription>Your session ended. Sign in again to continue.</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              aria-invalid={error !== undefined}
              aria-describedby={error !== undefined ? 'login-error' : undefined}
            />
          </div>
          {error !== undefined && (
            <p id="login-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <ArrowRightIcon />}
            Sign in
          </Button>
        </form>
        <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <a href="/cgi-bin/luci/" className="hover:text-foreground">
            Advanced (LuCI)
          </a>
          <ThemeToggle className="w-28" />
        </div>
      </div>
    </div>
  );
}
