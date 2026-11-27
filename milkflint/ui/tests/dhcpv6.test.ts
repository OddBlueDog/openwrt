// odhcpd's dhcp.lan.dhcpv6, as the UI reads it: unset means off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dhcpv6Mode } from '@/lib/dhcpv6';

test('dhcpv6Mode: server and hybrid serve leases, relay relays, anything else (or unset) is off', () => {
  assert.equal(dhcpv6Mode('server'), 'server');
  assert.equal(dhcpv6Mode('hybrid'), 'server');
  assert.equal(dhcpv6Mode('relay'), 'relay');
  assert.equal(dhcpv6Mode('disabled'), 'off');
  assert.equal(dhcpv6Mode(undefined), 'off');
  assert.equal(dhcpv6Mode(''), 'off');
  assert.equal(dhcpv6Mode('bogus'), 'off');
});
