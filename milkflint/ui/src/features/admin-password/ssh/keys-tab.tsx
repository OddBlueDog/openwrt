// The SSH keys tab: the keys that sign in as root without a password
// (/etc/dropbear/authorized_keys), added by pasting, dropping or picking a
// .pub file, removed after a confirm, each with the fingerprint your
// computer shows (ssh-add -l). Then how to make one: Ed25519, the strongest
// type the router's Dropbear takes, and what post-quantum means for SSH.
import { KeyRoundIcon, LoaderCircleIcon, ShieldAlertIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { Note } from '@/components/note';
import { GoLink } from '@/components/page-kit';
import { TextDrop } from '@/components/text-drop';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import type { ApplyState } from '@/hooks/use-apply';
import { tabLink } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { useSaveAuthorizedKeys } from '../queries';
import type { SshState } from './api';
import { addKeys, type Fit, keysOf, kindLabel, removeKey, signsIn, type SshKey } from './keys';
import { canSignInWithPassword, serversOf } from './model';

const nameOf = (k: SshKey): string => (k.comment === '' ? 'No name' : k.comment);

function KeyName({ k }: { k: SshKey }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={k.comment === '' ? 'text-muted-foreground' : undefined}>{nameOf(k)}</span>
      {k.options !== undefined && (
        <span className="truncate font-mono text-xs text-muted-foreground" title={k.options}>
          Only: {k.options}
        </span>
      )}
    </span>
  );
}

function KeyType({ k }: { k: SshKey }): ReactElement {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {kindLabel[k.kind]}
      {k.bits !== undefined && <span className="text-muted-foreground tabular">{k.bits}-bit</span>}
      {fitBadge[k.fit]}
    </span>
  );
}

// works: no word needed
const fitBadge: Readonly<Record<Fit, ReactNode>> = {
  recommended: <Badge variant="success">Recommended</Badge>,
  works: null,
  weak: <Badge variant="warning">Weak</Badge>,
  unsupported: <Badge variant="secondary">Can’t sign in yet</Badge>,
};

const fingerprintOf = (k: SshKey): ReactElement => <span className="font-mono text-xs break-all">{k.fingerprint}</span>;

function RemoveKey({ k, onRemove }: { k: SshKey; onRemove: (k: SshKey) => void }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label={`Remove ${nameOf(k)}`}
      onClick={() => {
        onRemove(k);
      }}
    >
      <Trash2Icon />
    </Button>
  );
}

/** Steps on the computer, for each kind of computer. */
type Os = 'mac' | 'linux' | 'windows';

const copyCommand: Readonly<Record<Os, string>> = {
  mac: 'pbcopy < ~/.ssh/id_ed25519.pub',
  linux: 'cat ~/.ssh/id_ed25519.pub',
  windows: 'Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | Set-Clipboard',
};

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }): ReactElement {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium tabular">{n}</span>
      <p className="self-center font-medium">{title}</p>
      <div className="col-start-2 flex flex-col gap-1 text-muted-foreground">{children}</div>
    </li>
  );
}

const Command = ({ children }: { children: string }): ReactElement => (
  <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">{children}</pre>
);

function MakeKeyCard(): ReactElement {
  const [os, setOs] = useState<Os>(() =>
    navigator.userAgent.includes('Win') ? 'windows' : navigator.userAgent.includes('Mac') ? 'mac' : 'linux',
  );
  return (
    <Card>
      <CardHeading
        title="Make a key"
        description="Keys you already have (RSA, ECDSA) work here. For a new one, Ed25519 is the one to make: short, quick and strong."
        action={
          <Segmented
            label="Your computer"
            value={os}
            onChange={setOs}
            options={[
              { value: 'mac', label: 'Mac' },
              { value: 'linux', label: 'Linux' },
              { value: 'windows', label: 'Windows' },
            ]}
          />
        }
      />
      <CardContent className="flex flex-col gap-4 text-sm">
        <ol className="flex flex-col gap-4">
          <Step n={1} title={os === 'windows' ? 'In PowerShell, make the key' : 'In Terminal, make the key'}>
            <Command>ssh-keygen -t ed25519 -C "my-laptop"</Command>
            <p>Enter takes the usual file. A passphrase locks the key if the computer is lost.</p>
          </Step>
          <Step
            n={2}
            title={os === 'linux' ? 'Show its public half, and paste it here' : 'Copy its public half, and paste it here'}
          >
            <Command>{copyCommand[os]}</Command>
          </Step>
          <Step n={3} title="Sign in">
            <Command>{`ssh root@${window.location.hostname}`}</Command>
          </Step>
        </ol>
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="font-medium">On a security key (a YubiKey, say)</p>
          <Command>ssh-keygen -t ed25519-sk</Command>
          <p className="text-muted-foreground">
            The key never leaves it, and each sign-in takes a touch.{' '}
            {os === 'mac' && 'macOS’s own ssh-keygen can’t make these: Homebrew’s OpenSSH can.'}
          </p>
        </div>
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="font-medium">Post-quantum keys?</p>
          <p className="text-muted-foreground">
            OpenSSH 10.6 added them (ML-DSA), but no Dropbear release takes them yet, the router’s 2026.94 included: add one and
            it waits here until one does. What matters most is already post-quantum: each session’s encryption, so a recording of
            it stays private. A key only has to hold at the moment you sign in, so Ed25519 is a sound choice today.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function KeysTab({ data, onStatus }: { data: SshState; onStatus: (s: ApplyState) => void }): ReactElement {
  const saveKeys = useSaveAuthorizedKeys();
  const keys = useMemo(() => keysOf(data.keys), [data.keys]);
  const passwords = canSignInWithPassword(serversOf(data.sections));
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<SshKey>();
  const columns = useMemo(
    (): readonly Column<SshKey>[] => [
      { label: 'Name', cell: (k) => <KeyName k={k} />, sort: nameOf, className: 'max-w-64' },
      { label: 'Type', cell: (k) => <KeyType k={k} />, sort: (k) => kindLabel[k.kind] },
      { label: 'Fingerprint', cell: fingerprintOf },
      { label: 'Remove', hidden: true, cell: (k) => <RemoveKey k={k} onRemove={setRemoving} />, className: 'w-10 text-right' },
    ],
    [],
  );
  const usable = keys.filter(signsIn);
  // the last key that signs in, with password logins off: removing it would leave no way in
  const lastWayIn = removing !== undefined && !passwords && usable.length === 1 && usable[0]?.line === removing.line;

  const write = async (text: string, title: string, note: string): Promise<boolean> => {
    setBusy(true);
    onStatus({ phase: 'applying' });
    try {
      // SSH's settings and keys are read again once written (the mutation's invalidation)
      await saveKeys.mutateAsync({ text, before: data.keys });
      onStatus({ phase: 'done', nothingChanged: false, title, note });
      return true;
    } catch (err) {
      onStatus({ phase: 'failed', message: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const r = addKeys(data.keys, input);
    if (r.error !== undefined) {
      setError(r.error);
      return;
    }
    if (r.added === 0) return;
    const one = r.added === 1;
    const note = r.notes.length > 0 ? r.notes.join(' ') : one ? 'It signs in now.' : 'They sign in now.';
    if (await write(r.text, one ? 'Key added' : `${String(r.added)} keys added`, note)) setInput('');
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex flex-col gap-4">
        <Card className="pb-0">
          <CardHeading
            title="Keys that sign in as root"
            description="An SSH key signs in without the password, and can’t be guessed. Any type works: only its public half comes here, the private half stays on your computer."
          />
          <DataTable
            label="SSH keys"
            columns={columns}
            card={(k) => (
              <div className="flex flex-col gap-1.5 px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <KeyName k={k} />
                  <RemoveKey k={k} onRemove={setRemoving} />
                </div>
                <KeyType k={k} />
                {fingerprintOf(k)}
              </div>
            )}
            rows={keys}
            rowKey={(k) => k.line}
            detail={(k) =>
              k.note === undefined ? undefined : (
                <Note tone="warning" icon={<TriangleAlertIcon />}>
                  {k.note}
                </Note>
              )
            }
            empty={
              <span className="flex items-center gap-2">
                <KeyRoundIcon className="size-4" aria-hidden="true" /> No keys yet: SSH takes the password alone.
              </span>
            }
            defaultOrder="As in the file"
            framed={false}
            inset
            wide="md"
          />
          <CardContent className="flex flex-col gap-2 border-t py-4">
            <TextDrop
              id="ssh-key-add"
              label="A public key to add"
              value={input}
              onChange={(t) => {
                setInput(t);
                setError(undefined);
              }}
              placeholder="Paste a public key (ssh-ed25519 AAAA… name, or ssh-rsa, ecdsa-sha2…), or drop its .pub file here"
              accept=".pub,text/plain"
              fileLabel="Open a .pub file"
              invalid={error !== undefined}
              describedBy={error === undefined ? undefined : 'ssh-key-add-error'}
              actions={
                <Button size="sm" disabled={input.trim() === '' || busy} onClick={() => void add()}>
                  {busy && <LoaderCircleIcon className="animate-spin" />}
                  Add key
                </Button>
              }
            />
            {error !== undefined && (
              <p id="ssh-key-add-error" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
        {usable.length > 0 && passwords && (
          <Note tone="info" icon={<ShieldAlertIcon />} title="Your key works? Turn password logins off">
            Then only a key signs in over SSH, and nobody can guess their way in.{' '}
            <GoLink to={tabLink('admin-password', 'ssh', 'password')} className="inline-flex">
              SSH settings
            </GoLink>
          </Note>
        )}
      </div>
      <MakeKeyCard />
      <Dialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing === undefined ? 'this key' : nameOf(removing)}?</DialogTitle>
            <DialogDescription>
              {lastWayIn
                ? 'It’s the only key, and password logins are off: nothing could sign in over SSH. Turn password logins on first.'
                : 'It can’t sign in over SSH once it’s gone.'}
            </DialogDescription>
          </DialogHeader>
          {removing !== undefined && <p className="font-mono text-xs break-all text-muted-foreground">{removing.fingerprint}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={lastWayIn || busy}
              onClick={() => {
                if (removing === undefined) return;
                void write(removeKey(data.keys, removing.line), 'Key removed', 'It no longer signs in.').then(() => {
                  setRemoving(undefined);
                });
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
