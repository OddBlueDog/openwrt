// The shared field schemas: one valid value and each kind of invalid one,
// with the caller's message.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formErrors } from '../src/lib/form/errors.ts';
import { ipToInt } from '../src/lib/api/network.ts';
import { ipv4, isPrivateIpv4, mac, portOrRange } from '../src/lib/schemas.ts';

const one = (schema: Parameters<typeof formErrors>[0], value: unknown): string | undefined => formErrors(schema, value)[''];

test('ipv4: four numbers up to 255', () => {
  const s = ipv4('An IPv4 address.');
  assert.equal(one(s, '192.168.1.1'), undefined);
  for (const bad of ['', '192.168.1', '192.168.1.256', '1.2.3.4.5', 'a.b.c.d', '1.2.3.-1']) {
    assert.equal(one(s, bad), 'An IPv4 address.', bad);
  }
});

test('isPrivateIpv4: 10/8, 172.16/12, 192.168/16 and nothing else', () => {
  const ok = (ip: string): boolean => isPrivateIpv4(ipToInt(ip) ?? -1);
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) assert.ok(ok(ip), ip);
  for (const ip of ['1.2.3.4', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.64.0.1']) assert.ok(!ok(ip), ip);
});

test('mac: six pairs with colons, either case', () => {
  const s = mac('A MAC address.');
  assert.equal(one(s, 'aa:BB:cc:00:11:22'), undefined);
  for (const bad of ['', 'aa-bb-cc-00-11-22', 'aa:bb:cc:00:11', 'aa:bb:cc:00:11:2g', 'aabbcc001122']) {
    assert.equal(one(s, bad), 'A MAC address.', bad);
  }
});

test('portOrRange: 1 to 65535, or a rising range with - or :', () => {
  const s = portOrRange('A port or a range.');
  for (const good of ['1', '443', '65535', '8000-8010', '8000:8010', '80-80']) assert.equal(one(s, good), undefined, good);
  for (const bad of ['', '0', '65536', '8010-8000', '80-', 'http', '1-70000']) {
    assert.equal(one(s, bad), 'A port or a range.', bad);
  }
});
