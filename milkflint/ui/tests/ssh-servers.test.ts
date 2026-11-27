// SSH servers on Router access (src/features/admin-password/ssh/model.ts):
// /etc/config/dropbear's instances as LuCI's SSH Access page shows them
// (Dropbear's defaults where an option is unset), the changes a save
// stages (only what changed, only the instances that changed), the checks
// before it, and a lockout caught: no way left to sign in over SSH.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canSignInWithPassword,
  lockoutError,
  newServer,
  portError,
  serverChanges,
  serversOf,
  type SshServer,
} from '@/features/admin-password/ssh/model';
import type { Section } from '@/lib/api/uci';

const main: Section = {
  '.type': 'dropbear',
  '.name': 'main',
  enable: '1',
  PasswordAuth: 'on',
  RootPasswordAuth: 'on',
  Port: '22',
};
const second: Section = { '.type': 'dropbear', '.name': 'cfg02dd4d', DirectInterface: 'lan', Port: '2222' };

const edit = (s: SshServer, change: Partial<SshServer>): SshServer => ({ ...s, ...change });

test('OpenWrt’s instance, and one with Dropbear’s defaults and a direct interface', () => {
  const [a, b] = serversOf([main, second]);
  assert.deepEqual(a, {
    section: 'main',
    enabled: true,
    network: '',
    direct: false,
    port: '22',
    passwords: true,
    rootPasswords: true,
    gatewayPorts: false,
  });
  assert.deepEqual(b, {
    section: 'cfg02dd4d',
    enabled: true,
    network: 'lan',
    direct: true,
    port: '2222',
    passwords: true,
    rootPasswords: true,
    gatewayPorts: false,
  });
  assert.equal(serversOf([{ '.type': 'dropbear', '.name': 'x', enable: '0', PasswordAuth: 'off' }])[0]?.enabled, false);
});

test('a save stages only what changed', () => {
  const sections = [main, second];
  const [a, b] = serversOf(sections) as [SshServer, SshServer];
  assert.deepEqual(serverChanges(sections, [a, b]), []);
  assert.deepEqual(serverChanges(sections, [edit(a, { passwords: false }), b]), [
    { op: 'set', config: 'dropbear', section: 'main', values: { PasswordAuth: 'off' } },
  ]);
  // from a direct interface to listening on its addresses
  assert.deepEqual(serverChanges(sections, [a, edit(b, { direct: false })]), [
    { op: 'set', config: 'dropbear', section: 'cfg02dd4d', values: { Interface: 'lan' } },
    { op: 'unset', config: 'dropbear', section: 'cfg02dd4d', options: ['DirectInterface'] },
  ]);
});

test('an instance added and one removed', () => {
  const sections = [main, second];
  const [a] = serversOf(sections) as [SshServer];
  const added = newServer([a]);
  assert.equal(added.section, undefined);
  assert.equal(added.port, '2222');
  assert.deepEqual(serverChanges(sections, [a, added]), [
    { op: 'delete', config: 'dropbear', section: 'cfg02dd4d' },
    {
      op: 'add',
      config: 'dropbear',
      type: 'dropbear',
      values: { enable: '1', Port: '2222', PasswordAuth: 'on', RootPasswordAuth: 'on', GatewayPorts: 'off' },
    },
  ]);
});

test('a port: a number from 1 to 65535, not one another instance has', () => {
  const [a, b] = serversOf([main, second]) as [SshServer, SshServer];
  assert.equal(portError(a, [a, b]), undefined);
  assert.match(portError(edit(a, { port: 'ssh' }), [a, b]) ?? '', /1 to 65535/);
  assert.match(portError(edit(a, { port: '0' }), [a, b]) ?? '', /1 to 65535/);
  assert.match(portError(edit(a, { port: '70000' }), [a, b]) ?? '', /1 to 65535/);
  const clash = edit(b, { port: '22' });
  assert.match(portError(clash, [a, clash]) ?? '', /another/);
  // an instance that's off doesn't hold its port
  assert.equal(portError(clash, [edit(a, { enabled: false }), clash]), undefined);
});

test('no way left to sign in over SSH: passwords off everywhere and no key', () => {
  const [a] = serversOf([main]) as [SshServer];
  assert.equal(canSignInWithPassword([a]), true);
  assert.equal(canSignInWithPassword([edit(a, { rootPasswords: false })]), false);
  assert.equal(lockoutError([a], 0), undefined);
  assert.match(lockoutError([edit(a, { passwords: false })], 0) ?? '', /key/);
  assert.equal(lockoutError([edit(a, { passwords: false })], 1), undefined);
  // SSH off altogether isn't a lockout: it's what was asked for
  assert.equal(lockoutError([edit(a, { enabled: false, passwords: false })], 0), undefined);
});
