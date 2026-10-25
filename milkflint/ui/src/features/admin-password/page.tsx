import { KeyRoundIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPassword } from '@/lib/api/system';
import { OLD_DEFAULT_PASSWORD, setAdminPassword, useSession } from '@/lib/session';
import { errorMessage } from '@/lib/utils';

type Status = { kind: 'idle' | 'busy' | 'done' } | { kind: 'error'; message: string };

export function AdminPasswordPage(): ReactElement {
  const [password, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const session = useSession();
  const none = session.status === 'authenticated' && session.adminPassword === 'none';
  const tooShort = password !== '' && password.length < 8;
  const mismatch = again !== '' && again !== password;

  const save = async (): Promise<void> => {
    setStatus({ kind: 'busy' });
    try {
      await setPassword(password);
      setAdminPassword(password === OLD_DEFAULT_PASSWORD ? 'old-default' : 'set');
      setPw('');
      setAgain('');
      setStatus({ kind: 'done' });
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) });
    }
  };

  return (
    <>
      <PageHeader title="Admin Password" description="The password for this page, LuCI and SSH (the root account)." />
      <Card className="max-w-xl">
        <CardHeading
          icon={KeyRoundIcon}
          title={none ? 'Set a password' : 'Change password'}
          description="Use at least 8 characters; a few random words work well."
        />
        <CardContent className="flex flex-col gap-4">
          {none && status.kind === 'idle' && (
            <Alert variant="warning">
              <AlertTitle>No password yet</AlertTitle>
              <AlertDescription>
                Until there is one, anyone on your network can sign in here, in LuCI and over SSH. A new or reset router starts without one, with
                Wi-Fi off, so only a device on a cable can get in until you set it up.
              </AlertDescription>
            </Alert>
          )}
          {status.kind === 'done' && (
            <Alert variant="success">
              <AlertTitle>Password saved</AlertTitle>
              <AlertDescription>Use it the next time you sign in here, in LuCI, or over SSH.</AlertDescription>
            </Alert>
          )}
          {status.kind === 'error' && (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t change the password</AlertTitle>
              <AlertDescription>{status.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={tooShort}
              onChange={(e) => {
                setPw(e.target.value);
                setStatus({ kind: 'idle' });
              }}
            />
            {tooShort && <p className="text-xs text-destructive">Use at least 8 characters.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-again">Type it again</Label>
            <Input
              id="pw-again"
              type="password"
              autoComplete="new-password"
              value={again}
              aria-invalid={mismatch}
              onChange={(e) => {
                setAgain(e.target.value);
              }}
            />
            {mismatch && <p className="text-xs text-destructive">The two don&apos;t match.</p>}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            disabled={password.length < 8 || again !== password || status.kind === 'busy'}
            onClick={() => void save()}
          >
            {status.kind === 'busy' && <LoaderCircleIcon className="animate-spin" />}
            {none ? 'Set password' : 'Change password'}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
