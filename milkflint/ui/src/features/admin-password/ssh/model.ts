// The router's SSH servers: /etc/config/dropbear's instances, with the
// settings LuCI's SSH Access page has, Dropbear's defaults where an option
// is unset. A save writes only the options that changed, so an option set
// another way ('1' for 'on') stays as it was.
import { z } from 'zod';
import { bool, type Change, type Section, sectionChanges, str } from '@/lib/api/uci';

const sshServerSchema = z.object({
  /** Its section in /etc/config/dropbear; undefined until a new one is saved. */
  section: z.union([z.string(), z.undefined()]),
  enabled: z.boolean(),
  /** The network (interface) it answers on; '' for every one. */
  network: z.string(),
  /** Bound to the network's device itself (DirectInterface), not only its addresses (Interface). */
  direct: z.boolean(),
  port: z.string(),
  /** Signing in with a password at all. */
  passwords: z.boolean(),
  /** root signing in with a password. */
  rootPasswords: z.boolean(),
  /** Ports forwarded over SSH open to other devices, not only to the router itself. */
  gatewayPorts: z.boolean(),
});

export type SshServer = z.infer<typeof sshServerSchema>;

const CONFIG = 'dropbear';
const DEFAULT_PORT = '22';

type Flag = 'enabled' | 'passwords' | 'rootPasswords' | 'gatewayPorts';

// each switch's option, its default when unset, and how it's written (as LuCI writes it)
const flags: readonly { field: Flag; option: string; fallback: boolean; on: string; off: string }[] = [
  { field: 'enabled', option: 'enable', fallback: true, on: '1', off: '0' },
  { field: 'passwords', option: 'PasswordAuth', fallback: true, on: 'on', off: 'off' },
  { field: 'rootPasswords', option: 'RootPasswordAuth', fallback: true, on: 'on', off: 'off' },
  { field: 'gatewayPorts', option: 'GatewayPorts', fallback: false, on: 'on', off: 'off' },
];

export function serversOf(sections: readonly Section[]): SshServer[] {
  return sections
    .filter((s) => s['.type'] === CONFIG)
    .map((s) => {
      const direct = str(s, 'DirectInterface');
      return {
        section: s['.name'],
        enabled: bool(s, 'enable', true),
        network: direct ?? str(s, 'Interface') ?? '',
        direct: direct !== undefined,
        port: str(s, 'Port') ?? DEFAULT_PORT,
        passwords: bool(s, 'PasswordAuth', true),
        rootPasswords: bool(s, 'RootPasswordAuth', true),
        gatewayPorts: bool(s, 'GatewayPorts', false),
      };
    });
}

/** Another server, on the first free port from 2222. */
export function newServer(existing: readonly SshServer[]): SshServer {
  let port = 2222;
  while (existing.some((s) => s.port === String(port))) port++;
  return {
    section: undefined,
    enabled: true,
    network: '',
    direct: false,
    port: String(port),
    passwords: true,
    rootPasswords: true,
    gatewayPorts: false,
  };
}

const interfaceOptions = (direct: boolean): ['DirectInterface' | 'Interface', 'DirectInterface' | 'Interface'] =>
  direct ? ['DirectInterface', 'Interface'] : ['Interface', 'DirectInterface'];

/** The options of a server that differ from its section: a value to set, undefined to unset. */
function changedOptions(s: Section | undefined, server: SshServer): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};
  for (const f of flags) {
    if (s === undefined || bool(s, f.option, f.fallback) !== server[f.field]) options[f.option] = server[f.field] ? f.on : f.off;
  }
  if (s === undefined || (str(s, 'Port') ?? DEFAULT_PORT) !== server.port) options['Port'] = server.port;
  const [use, other] = interfaceOptions(server.direct);
  if ((str(s, use) ?? '') !== server.network) options[use] = server.network === '' ? undefined : server.network;
  if (s?.[other] !== undefined) options[other] = undefined;
  return options;
}

/** What a save stages: instances removed, then each one's changes in the page's order. */
export function serverChanges(sections: readonly Section[], draft: readonly SshServer[]): Change[] {
  const kept = new Set(draft.map((d) => d.section));
  const removed: Change[] = serversOf(sections)
    .filter((s) => !kept.has(s.section))
    .map((s) => ({ op: 'delete', config: CONFIG, section: s.section ?? '' }));
  return [
    ...removed,
    ...draft.flatMap((server): Change[] => {
      if (server.section === undefined) {
        const values = Object.fromEntries(
          Object.entries(changedOptions(undefined, server)).filter((e): e is [string, string] => e[1] !== undefined),
        );
        return [{ op: 'add', config: CONFIG, type: CONFIG, values }];
      }
      const s = sections.find((x) => x['.name'] === server.section);
      return sectionChanges(CONFIG, [...sections], server.section, changedOptions(s, server));
    }),
  ];
}

export function portError(server: SshServer, all: readonly SshServer[]): string | undefined {
  const n = Number(server.port);
  if (!/^\d+$/.test(server.port) || n < 1 || n > 65535) return 'A port is a number from 1 to 65535.';
  if (server.enabled && all.some((o) => o !== server && o.enabled && o.port === server.port))
    return 'This port is taken by another SSH server here.';
  return undefined;
}

/** Whether root can sign in over SSH with the password, on any server that's on. */
export function canSignInWithPassword(servers: readonly SshServer[]): boolean {
  return servers.some((s) => s.enabled && s.passwords && s.rootPasswords);
}

/** Saving this would leave SSH on with no way to sign in: no password logins, no key. */
export function lockoutError(servers: readonly SshServer[], keys: number): string | undefined {
  if (keys > 0 || !servers.some((s) => s.enabled) || canSignInWithPassword(servers)) return undefined;
  return 'Add an SSH key first: with password logins off and no key, nothing could sign in over SSH.';
}

/**
 * The SSH tab's form: every server, each port valid and its own, and no
 * saving SSH into a state nothing could sign in with (`keys`: the keys that
 * sign in now).
 */
export function sshServersSchema(keys: number): z.ZodType<{ servers: SshServer[] }, { servers: SshServer[] }> {
  return z.object({ servers: z.array(sshServerSchema) }).superRefine(({ servers }, ctx) => {
    const lockout = lockoutError(servers, keys);
    servers.forEach((s, i) => {
      const port = portError(s, servers);
      if (port !== undefined) ctx.addIssue({ code: 'custom', path: ['servers', i, 'port'], message: port });
      if (lockout !== undefined && s.enabled && !s.passwords)
        ctx.addIssue({ code: 'custom', path: ['servers', i, 'passwords'], message: lockout });
    });
  });
}
