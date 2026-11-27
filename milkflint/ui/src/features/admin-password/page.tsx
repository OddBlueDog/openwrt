// Router access: who can sign in to these pages, LuCI and SSH, and how;
// LuCI's Administration pages in one (Router Password, SSH Access, SSH-Keys,
// HTTP(S) Access, Repository Public Keys). It opens on the answer: is a
// password set, is HTTPS on, what SSH takes. Each part is a tab in the
// address (#/admin-password/ssh-keys); the route stays #/admin-password,
// which the password reminder links to, and #/https lands on its tab.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { Answer, AnswerCell, GoLink } from '@/components/page-kit';
import { LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { type ApplyState, useApply } from '@/hooks/use-apply';
import { type PageLink, tabFrom, tabLink, useSubPath } from '@/lib/router';
import { type AdminPassword, useSession } from '@/lib/session';
import { CertificateCard, HttpsCard, Moved } from '../https/section';
import { httpsAnswer, useHttps } from '../https/use-https';
import { PackageKeysTab } from './package-keys/tab';
import { PasswordCard } from './password-card';
import { accessQueries } from './queries';
import type { SshState } from './ssh/api';
import { keysOf, signsIn } from './ssh/keys';
import { KeysTab } from './ssh/keys-tab';
import { canSignInWithPassword, serversOf } from './ssh/model';
import { ServersTab } from './ssh/servers-tab';

type Tab = 'password' | 'https' | 'ssh' | 'ssh-keys' | 'package-keys';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'password', label: 'Password' },
  { id: 'https', label: 'HTTPS' },
  { id: 'ssh', label: 'SSH' },
  { id: 'ssh-keys', label: 'SSH keys' },
  { id: 'package-keys', label: 'Package keys' },
];

const tabTo = (tab: Tab): PageLink => tabLink('admin-password', tab, 'password');

/** What SSH does with the password, as saved: undefined until it's read. */
interface SshAnswer {
  on: boolean;
  passwords: boolean;
  keys: number;
  ports: string[];
}

function sshAnswerOf(data: SshState | undefined): SshAnswer | undefined {
  if (data === undefined) return undefined;
  const on = serversOf(data.sections).filter((s) => s.enabled);
  return {
    on: on.length > 0,
    passwords: canSignInWithPassword(on),
    keys: keysOf(data.keys).filter(signsIn).length,
    ports: on.map((s) => s.port),
  };
}

/** Where the password is asked for. */
function whereOf(ssh: SshAnswer | undefined): string {
  return ssh !== undefined && (!ssh.on || !ssh.passwords) ? 'here and in LuCI' : 'here, in LuCI and over SSH';
}

function passwordAnswer(
  password: AdminPassword,
  ssh: SshAnswer | undefined,
): { badge: ReactElement; text: string; next: string } {
  const where = whereOf(ssh);
  switch (password) {
    case 'set':
      return {
        badge: <Badge variant="success">Password set</Badge>,
        text: `Signing in ${where} needs it.${ssh?.on === true && ssh.passwords ? ' An SSH key signs in without it.' : ''}`,
        next: 'Change it',
      };
    case 'none':
      return {
        badge: <Badge variant="warning">No password</Badge>,
        text: `Anyone on your network can sign in ${where}. A new or reset router starts without one, with Wi-Fi off, so only a device on a cable can get in until you set it.`,
        next: 'Set one',
      };
    case 'old-default':
      return {
        badge: <Badge variant="warning">Default password</Badge>,
        text: `It’s the old default password, so anyone on your network can sign in ${where}.`,
        next: 'Change it',
      };
  }
}

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

function SshCell({ ssh, failed }: { ssh: SshAnswer | undefined; failed: boolean }): ReactElement {
  if (ssh === undefined) {
    return (
      <AnswerCell
        title="SSH"
        value={failed ? <Badge variant="destructive">Couldn’t check</Badge> : <Skeleton className="h-6 w-24 rounded-full" />}
      >
        {failed ? 'The router didn’t say how SSH is set: see the SSH tab.' : undefined}
      </AnswerCell>
    );
  }
  const badge = !ssh.on ? (
    <Badge variant="secondary">Off</Badge>
  ) : !ssh.passwords ? (
    <Badge variant="success">Keys only</Badge>
  ) : ssh.keys > 0 ? (
    <Badge variant="success">Keys and password</Badge>
  ) : (
    <Badge variant="info">Password only</Badge>
  );
  return (
    <AnswerCell
      title="SSH"
      value={badge}
      action={<GoLink to={tabTo(ssh.keys === 0 ? 'ssh-keys' : 'ssh')}>{ssh.keys === 0 ? 'Add a key' : 'SSH settings'}</GoLink>}
    >
      {ssh.on
        ? `On port ${ssh.ports.join(' and ')}, ${ssh.keys === 0 ? 'no keys yet' : `${plural(ssh.keys, 'key')} that sign${ssh.keys === 1 ? 's' : ''} in`}. Sessions are post-quantum encrypted.`
        : 'Nothing answers SSH.'}
    </AnswerCell>
  );
}

export function RouterAccessPage(): ReactElement {
  const navigate = useNavigate();
  const session = useSession();
  const password: AdminPassword = session.status === 'authenticated' ? session.adminPassword : 'set';
  const tab = tabFrom(useSubPath(), TABS, 'password');
  const h = useHttps();
  const sshQuery = useQuery(accessQueries.ssh());
  const { refetch: refetchSsh } = sshQuery;
  const ssh = {
    data: sshQuery.data,
    error: sshQuery.error ?? undefined,
    reload: () => {
      void refetchSsh();
    },
  };
  // a save reads SSH's settings again (useApply refreshes every query)
  const sshApply = useApply();
  const [status, setStatus] = useState<ApplyState>({ phase: 'idle' });
  // one toast: the last thing saved here
  const [last, setLast] = useState<'https' | 'ssh' | 'other'>('other');
  const report = (s: ApplyState): void => {
    setLast('other');
    setStatus(s);
  };

  const sshAnswer = sshAnswerOf(ssh.data);
  const pa = passwordAnswer(password, sshAnswer);
  const ha = httpsAnswer(h);
  const httpsFailed = h.error !== undefined && h.data === undefined;
  const sshFailed = ssh.error !== undefined && ssh.data === undefined;
  const sshPanel = (body: (data: SshState) => ReactElement): ReactElement =>
    sshFailed ? (
      <LoadError error={ssh.error} retry={ssh.reload} />
    ) : ssh.data === undefined ? (
      <Skeleton className="h-64 rounded-xl" />
    ) : (
      body(ssh.data)
    );

  return (
    <>
      <PageHeader title="Router access" description="Who can sign in to these pages, LuCI and SSH, and how." />
      <div className="flex flex-col gap-4">
        {h.state.phase === 'moved' ? (
          <Moved url={h.state.url} fingerprint={h.fingerprint} />
        ) : (
          <ApplyStatus state={last === 'https' ? h.state : last === 'ssh' ? sshApply.state : status} />
        )}
        <Answer columns={3} label="Router access now">
          <AnswerCell title="Who can sign in" value={pa.badge} action={<GoLink to={tabTo('password')}>{pa.next}</GoLink>}>
            {pa.text}
          </AnswerCell>
          {httpsFailed ? (
            <AnswerCell title="Encrypted connection (HTTPS)" value={<Badge variant="destructive">Couldn’t check</Badge>}>
              The router didn’t say what its web server does: see the HTTPS tab.
            </AnswerCell>
          ) : h.data === undefined ? (
            <AnswerCell title="Encrypted connection (HTTPS)" value={<Skeleton className="h-6 w-20 rounded-full" />} />
          ) : (
            <AnswerCell
              title="Encrypted connection (HTTPS)"
              value={ha.badge}
              action={
                ha.next ?? (h.form === undefined ? undefined : <GoLink to={tabTo('https')}>HTTPS and the certificate</GoLink>)
              }
            >
              {ha.text}
            </AnswerCell>
          )}
          <SshCell ssh={sshAnswer} failed={sshFailed} />
        </Answer>
        <Tabs
          label="Router access"
          prefix="ra"
          items={TABS}
          value={tab}
          onChange={(t) => {
            void navigate(tabTo(t));
          }}
          className="mt-2"
        />
        {/* every tab stays mounted, so unsaved edits survive a look at another tab */}
        <TabPanel prefix="ra" id="password" value={tab} className="max-w-2xl">
          <PasswordCard password={password} where={whereOf(sshAnswer)} onResult={report} />
        </TabPanel>
        <TabPanel prefix="ra" id="https" value={tab} className="flex flex-col gap-4">
          {httpsFailed ? (
            <LoadError error={h.error} retry={h.reload} />
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <HttpsCard h={h} id="https-settings" />
              <CertificateCard h={h} />
            </div>
          )}
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
        </TabPanel>
        <TabPanel prefix="ra" id="ssh" value={tab}>
          {sshPanel((data) => (
            <ServersTab
              data={data}
              busy={sshApply.state.phase === 'applying'}
              onSave={(changes) => {
                setLast('ssh');
                void sshApply.apply(changes);
              }}
            />
          ))}
        </TabPanel>
        <TabPanel prefix="ra" id="ssh-keys" value={tab}>
          {sshPanel((data) => (
            <KeysTab data={data} onStatus={report} />
          ))}
        </TabPanel>
        <TabPanel prefix="ra" id="package-keys" value={tab}>
          <PackageKeysTab onStatus={report} />
        </TabPanel>
      </div>
    </>
  );
}
