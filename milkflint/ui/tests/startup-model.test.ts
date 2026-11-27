// The Startup page (src/features/startup/model.ts): the services in
// /etc/init.d as rpcd's rc list gives them, in start order as LuCI lists
// them (those that don't start at boot last, rather than left out), what
// stopping or turning off a service the router can't do without would do,
// and /etc/rc.local as LuCI saves it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consequence, describeService, rcLocalText, servicesOf } from '@/features/startup/model';

test('in start order, then by name; those without a start number last', () => {
  const rows = servicesOf({
    uhttpd: { start: 50, enabled: true, running: true },
    boot: { start: 10, stop: 90, enabled: true },
    'milkflint-vpn': { enabled: false },
    system: { start: 10, enabled: true, running: false },
    firewall: { start: 19, enabled: true, running: false },
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ['boot', 'system', 'firewall', 'uhttpd', 'milkflint-vpn'],
  );
  assert.deepEqual(rows[0], { name: 'boot', start: 10, enabled: true, running: undefined });
  assert.deepEqual(rows[4], { name: 'milkflint-vpn', start: undefined, enabled: false, running: undefined });
});

test('what stopping a service the router needs would do; nothing said for the rest', () => {
  assert.match(consequence('uhttpd') ?? '', /this page/i);
  assert.match(consequence('network') ?? '', /network/i);
  assert.match(consequence('firewall') ?? '', /internet/i);
  assert.equal(consequence('nlbwmon'), undefined);
  assert.match(describeService('dnsmasq') ?? '', /DHCP/);
  assert.equal(describeService('something-else'), undefined);
});

test('rc.local saved as LuCI saves it: Windows line ends gone, one newline at the end', () => {
  assert.equal(rcLocalText('echo hi\r\nexit 0\r\n\r\n'), 'echo hi\nexit 0\n');
  assert.equal(rcLocalText('exit 0'), 'exit 0\n');
  assert.equal(rcLocalText('   '), '\n');
});
