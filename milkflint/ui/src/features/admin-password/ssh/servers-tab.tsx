// The SSH tab: the router's SSH servers (Dropbear's instances), each with
// LuCI's SSH Access settings, plus a server added or removed as LuCI's "Add
// instance" does. Saved through UCI; Dropbear restarts its listener on its
// own, and sessions already open stay.
import { InfoIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useMemo } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { MoreSettings } from '@/components/more-settings';
import { Note } from '@/components/note';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Change } from '@/lib/api/uci';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { accessQueries } from '../queries';
import type { SshState } from './api';
import { keysOf, signsIn } from './keys';
import { lockoutError, newServer, portError, serverChanges, serversOf, type SshServer, sshServersSchema } from './model';

// Radix's Select won't take '' as a value
const EVERY = '*';

function ServerCard({
  n,
  server,
  all,
  networks,
  lockout,
  onChange,
  onRemove,
}: {
  n: number | undefined;
  server: SshServer;
  all: readonly SshServer[];
  networks: readonly string[];
  lockout: string | undefined;
  onChange: (s: SshServer) => void;
  onRemove: () => void;
}): ReactElement {
  const at = `ssh-${String(n ?? 1)}`;
  const set = <K extends keyof SshServer>(key: K, value: SshServer[K]): void => {
    onChange({ ...server, [key]: value });
  };
  const portProblem = portError(server, all);
  // a network named in the config that's gone stays a choice, so the page shows what's set
  const choices = server.network === '' || networks.includes(server.network) ? networks : [...networks, server.network];
  const unusual = [
    !server.rootPasswords && 'root needs a key',
    server.direct && 'bound to the network',
    server.gatewayPorts && 'gateway ports on',
  ].filter((x) => x !== false);
  return (
    <Card>
      <CardHeading
        title={n === undefined ? 'SSH server' : `SSH server ${String(n)}`}
        description="Dropbear: a command line on the router, and file copies with scp -O (the router has no SFTP)."
        action={
          <Switch
            checked={server.enabled}
            aria-label={`${n === undefined ? 'SSH server' : `SSH server ${String(n)}`} on`}
            onCheckedChange={(v) => {
              set('enabled', v);
            }}
          />
        }
      />
      <CardContent className="flex flex-col">
        <div className="divide-y border-t">
          <Field id={`${at}-port`} label="Port" hint="22 is SSH’s usual one." error={portProblem}>
            <Input
              id={`${at}-port`}
              inputMode="numeric"
              className="w-28 tabular"
              value={server.port}
              aria-invalid={portProblem !== undefined}
              aria-describedby={portProblem === undefined ? undefined : `${at}-port-error`}
              onChange={(e) => {
                set('port', e.target.value.trim());
              }}
            />
          </Field>
          <Field
            id={`${at}-network`}
            label="Answers on"
            hint="The firewall still decides whether the internet can reach it: by default it can’t."
          >
            <Select
              value={server.network === '' ? EVERY : server.network}
              onValueChange={(v) => {
                onChange({ ...server, network: v === EVERY ? '' : v, direct: v === EVERY ? false : server.direct });
              }}
            >
              <SelectTrigger id={`${at}-network`} className="w-full max-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERY}>Every network</SelectItem>
                {choices.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id={`${at}-passwords`}
            label="Password logins"
            hint="Off, only SSH keys sign in: nothing to guess. Turn it off once your key works."
            error={lockout}
          >
            <Switch
              id={`${at}-passwords`}
              checked={server.passwords}
              onCheckedChange={(v) => {
                set('passwords', v);
              }}
            />
          </Field>
        </div>
        <MoreSettings summary={unusual.length > 0 ? unusual.join(', ') : 'As OpenWrt sets them'}>
          <Field
            id={`${at}-root`}
            label="root with a password"
            hint="Off, root signs in with a key only. root is the router’s one account, so this is password logins by another name."
            why={
              <>
                Dropbear’s <span className="font-mono">RootPasswordAuth</span> option.
              </>
            }
          >
            <Switch
              id={`${at}-root`}
              checked={server.rootPasswords}
              disabled={!server.passwords}
              onCheckedChange={(v) => {
                set('rootPasswords', v);
              }}
            />
          </Field>
          <Field
            id={`${at}-direct`}
            label="Bound to the network"
            hint="Listens on the network’s device itself, not only its addresses, so it keeps answering as they change."
            why={
              <>
                Dropbear’s <span className="font-mono">DirectInterface</span> option, in place of{' '}
                <span className="font-mono">Interface</span>, which listens on up to 10 of the network’s addresses.
              </>
            }
          >
            <Switch
              id={`${at}-direct`}
              checked={server.direct}
              disabled={server.network === ''}
              onCheckedChange={(v) => {
                set('direct', v);
              }}
            />
          </Field>
          <Field
            id={`${at}-gateway`}
            label="Gateway ports"
            hint="Ports you forward over SSH (ssh -R) open to other devices too, not only to the router itself."
            why={
              <>
                Dropbear’s <span className="font-mono">GatewayPorts</span> option.
              </>
            }
          >
            <Switch
              id={`${at}-gateway`}
              checked={server.gatewayPorts}
              onCheckedChange={(v) => {
                set('gatewayPorts', v);
              }}
            />
          </Field>
        </MoreSettings>
        <div className="flex justify-end border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2Icon /> Remove this server
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** What protects the connection, and what's needed on the computer for it. */
function PostQuantumCard(): ReactElement {
  return (
    <Card>
      <CardHeading title="Post-quantum connections" />
      <CardContent className="flex flex-col gap-3 text-sm">
        <Note tone="success" icon={<ShieldCheckIcon />}>
          Each session’s keys are agreed with a hybrid post-quantum exchange (ML-KEM or sntrup761, each with X25519), so a
          recording of it can’t be decrypted later, even by a quantum computer.
        </Note>
        <p className="text-muted-foreground">
          Your computer needs OpenSSH 9.0 or newer, as macOS 13 and later, current Linux and Windows 11 have. To see it, sign in
          with <span className="font-mono text-xs">ssh -v</span> and look for{' '}
          <span className="font-mono text-xs">kex: algorithm: mlkem768x25519</span> or{' '}
          <span className="font-mono text-xs">sntrup761x25519</span>.
        </p>
      </CardContent>
    </Card>
  );
}

export function ServersTab({
  data,
  busy,
  onSave,
}: {
  data: SshState;
  busy: boolean;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const interfaces = useQuery(accessQueries.interfaces());
  const networks = (interfaces.data ?? []).map((i) => i.interface).filter((n) => n !== 'loopback');
  const keys = keysOf(data.keys).filter(signsIn).length;
  const schema = useMemo(() => sshServersSchema(keys), [keys]);
  const saved = useMemo(() => ({ servers: serversOf(data.sections) }), [data.sections]);
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: (values) => {
      onSave(serverChanges(data.sections, values.servers));
    },
  });
  const { form } = settings;
  const { servers } = useFormValues(form);
  // the checks as they stand: a lockout or a bad port keeps Save off
  const lockout = lockoutError(servers, keys);
  const invalid = lockout !== undefined || servers.some((s) => portError(s, servers) !== undefined);
  const setServers = (next: SshServer[]): void => {
    form.setFieldValue('servers', next);
  };
  const edit = (i: number, s: SshServer): void => {
    setServers(servers.map((x, j) => (j === i ? s : x)));
  };

  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          {servers.length === 0 && (
            <Note tone="warning" icon={<TriangleAlertIcon />} title="No SSH server">
              Nothing answers SSH on the router. Add one to sign in with a command line.
            </Note>
          )}
          {servers.map((s, i) => (
            <ServerCard
              // a new one has no section yet: its place stands in
              key={s.section ?? `new-${String(i)}`}
              n={servers.length > 1 ? i + 1 : undefined}
              server={s}
              all={servers}
              networks={networks}
              lockout={s.enabled && !s.passwords ? lockout : undefined}
              onChange={(next) => {
                edit(i, next);
              }}
              onRemove={() => {
                setServers(servers.filter((_, j) => j !== i));
              }}
            />
          ))}
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => {
              setServers([...servers, newServer(servers)]);
            }}
          >
            <PlusIcon /> Add an SSH server
          </Button>
          {servers.length > 0 && !servers.some((s) => s.enabled) && (
            <Note tone="info" icon={<InfoIcon />}>
              Every SSH server is off: nothing answers SSH. These pages and LuCI work as before.
            </Note>
          )}
        </div>
        <PostQuantumCard />
      </div>
      <SaveBar visible={settings.dirty} busy={busy} invalid={invalid} onSave={settings.save} onRevert={settings.discard} />
    </>
  );
}
