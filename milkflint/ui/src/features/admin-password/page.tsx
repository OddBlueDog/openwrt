// Router access: who can sign in to these pages, LuCI and SSH (the root
// account's password; a fresh install has none), and the encrypted
// connection to them (HTTPS and its certificate). It opens on the answer:
// is a password set, is HTTPS on. The route stays #/admin-password, which
// the password reminder links to; #/https lands on the HTTPS card here.
import { ChevronRightIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApplyState } from '@/hooks/use-apply';
import { setPassword } from '@/lib/api/system';
import { useSubPath } from '@/lib/router';
import { type AdminPassword, OLD_DEFAULT_PASSWORD, setAdminPassword, useSession } from '@/lib/session';
import { errorMessage } from '@/lib/utils';
import { CertificateCard, HttpsCard, Moved } from '../https/section';
import { httpsAnswer, useHttps } from '../https/use-https';

const PASSWORD_ID = 'password';
const HTTPS_ID = 'https';

/** Brings a card into view and puts the keyboard in it (its first field, or the card itself). */
function goTo(id: string, field?: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (field !== undefined) document.getElementById(field)?.focus({ preventScroll: true });
}

function Cell({
  title,
  status,
  children,
  next,
}: {
  title: string;
  status: ReactNode;
  children: ReactNode;
  next?: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex min-h-6 items-center">{status}</div>
      <p className="text-sm text-foreground">{children}</p>
      {next !== undefined && <div className="mt-auto pt-1">{next}</div>}
    </div>
  );
}

function Jump({ onClick, children }: { onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit cursor-pointer items-center gap-0.5 rounded-sm text-sm font-medium link underline-offset-4"
    >
      {children}
      <ChevronRightIcon className="size-4" />
    </button>
  );
}

const passwordAnswer: Record<AdminPassword, { badge: ReactElement; text: string; next: string }> = {
  set: {
    badge: <Badge variant="success">Password set</Badge>,
    text: 'Signing in here, in LuCI and over SSH (the root account) needs it.',
    next: 'Change it',
  },
  none: {
    badge: <Badge variant="warning">No password</Badge>,
    text: 'Anyone on your network can sign in here, in LuCI and over SSH. A new or reset router starts without one, with Wi-Fi off, so only a device on a cable can get in until you set it.',
    next: 'Set one',
  },
  'old-default': {
    badge: <Badge variant="warning">Default password</Badge>,
    text: 'It’s the old default password, so anyone on your network can sign in here, in LuCI and over SSH.',
    next: 'Change it',
  },
};

function PasswordCard({ password, onResult }: { password: AdminPassword; onResult: (s: ApplyState) => void }): ReactElement {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = pw !== '' && pw.length < 8;
  const mismatch = again !== '' && again !== pw;
  const none = password === 'none';

  const save = async (): Promise<void> => {
    setBusy(true);
    onResult({ phase: 'applying' });
    try {
      await setPassword(pw);
      setAdminPassword(pw === OLD_DEFAULT_PASSWORD ? 'old-default' : 'set');
      setPw('');
      setAgain('');
      onResult({ phase: 'done', nothingChanged: false, note: 'Use it the next time you sign in here, in LuCI, or over SSH.' });
    } catch (err) {
      onResult({ phase: 'failed', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id={PASSWORD_ID} className="scroll-mt-6">
      <CardHeading
        title={none ? 'Set the admin password' : 'Change the admin password'}
        description="The root account’s password, for these pages, LuCI and SSH. A few random words work well."
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length >= 8 && again === pw && !busy) void save();
        }}
      >
        <CardContent className="divide-y border-t">
          <Field
            id="pw-new"
            label="New password"
            hint="At least 8 characters."
            error={tooShort ? 'Use at least 8 characters.' : undefined}
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={pw}
              aria-invalid={tooShort}
              aria-describedby={tooShort ? 'pw-new-error' : undefined}
              onChange={(e) => {
                setPw(e.target.value);
                onResult({ phase: 'idle' });
              }}
            />
          </Field>
          <Field id="pw-again" label="Type it again" error={mismatch ? 'The two don’t match.' : undefined}>
            <Input
              id="pw-again"
              type="password"
              autoComplete="new-password"
              value={again}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'pw-again-error' : undefined}
              onChange={(e) => {
                setAgain(e.target.value);
              }}
            />
          </Field>
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

export function RouterAccessPage(): ReactElement {
  const session = useSession();
  const password: AdminPassword = session.status === 'authenticated' ? session.adminPassword : 'set';
  const h = useHttps();
  const [pwState, setPwState] = useState<ApplyState>({ phase: 'idle' });
  // one toast: the last thing saved here
  const [last, setLast] = useState<'password' | 'https'>('https');
  const sub = useSubPath();
  const scrolled = useRef(false);
  const ready = h.data !== undefined;
  // #/https (and #/admin-password/https) opens on the HTTPS card
  useEffect(() => {
    if (sub !== HTTPS_ID || !ready || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(HTTPS_ID)?.scrollIntoView({ block: 'start' });
  }, [sub, ready]);

  const pa = passwordAnswer[password];
  const ha = httpsAnswer(h);
  const httpsFailed = h.error !== undefined && h.data === undefined;

  return (
    <>
      <PageHeader
        title="Router access"
        description="Who can sign in to these pages, LuCI and SSH, and the encrypted connection to them."
      />
      <div className="flex flex-col gap-4">
        {h.state.phase === 'moved' ? (
          <Moved url={h.state.url} fingerprint={h.fingerprint} />
        ) : (
          <ApplyStatus state={last === 'password' ? pwState : h.state} />
        )}
        <Card className="gap-0 py-0">
          <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            <Cell
              title="Who can sign in"
              status={pa.badge}
              next={
                <Jump
                  onClick={() => {
                    goTo(PASSWORD_ID, 'pw-new');
                  }}
                >
                  {pa.next}
                </Jump>
              }
            >
              {pa.text}
            </Cell>
            {httpsFailed ? (
              <Cell title="Encrypted connection (HTTPS)" status={<Badge variant="destructive">Couldn’t check</Badge>}>
                The router didn’t say what its web server does: see below.
              </Cell>
            ) : h.data === undefined ? (
              <div className="flex flex-col gap-2 p-5">
                <h2 className="text-sm font-medium text-muted-foreground">Encrypted connection (HTTPS)</h2>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <Cell
                title="Encrypted connection (HTTPS)"
                status={ha.badge}
                next={
                  ha.next ??
                  (h.form === undefined ? undefined : (
                    <Jump
                      onClick={() => {
                        goTo(HTTPS_ID);
                      }}
                    >
                      HTTPS and the certificate
                    </Jump>
                  ))
                }
              >
                {ha.text}
              </Cell>
            )}
          </div>
        </Card>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <PasswordCard
            password={password}
            onResult={(s) => {
              setLast('password');
              setPwState(s);
            }}
          />
          {httpsFailed ? <LoadError error={h.error} retry={h.reload} /> : <HttpsCard h={h} id={HTTPS_ID} />}
        </div>
        <CertificateCard h={h} />
        <SaveBar
          // once moved, this page's calls go to the other protocol: nothing more to save here
          visible={h.dirty && h.state.phase !== 'moved'}
          busy={h.state.phase === 'applying'}
          invalid={false}
          onSave={() => {
            setLast('https');
            h.save();
          }}
          onRevert={h.revert}
        />
      </div>
    </>
  );
}
