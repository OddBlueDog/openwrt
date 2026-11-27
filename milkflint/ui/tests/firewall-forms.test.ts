// The Firewall page's sheet forms as schemas: a traffic rule's, a NAT
// rule's, a zone's and the defaults', each message as the sheets showed it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFirewall } from '../src/features/firewall/model.ts';
import { natFormOf, natFormSchema } from '../src/features/firewall/nat-form.ts';
import { formOf, ruleFormSchema } from '../src/features/firewall/rule-form.ts';
import { defaultsFormOf, defaultsFormSchema, type ZoneForm, zoneFormSchema } from '../src/features/firewall/zone-form.ts';
import { formErrors } from '../src/lib/form/errors.ts';
import { section } from './uci-fixture.ts';

const cfg = parseFirewall([
  section('defaults', 'cfg01', { input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', synflood_protect: '1' }),
  section('zone', 'lan', { name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' }),
  section('zone', 'wan', {
    name: 'wan',
    network: ['wan', 'wan6'],
    input: 'REJECT',
    output: 'ACCEPT',
    forward: 'REJECT',
    masq: '1',
  }),
]);

test('a new rule from the internet to the router: a name, then ports or the tick', () => {
  const schema = ruleFormSchema(cfg);
  const f = formOf(undefined, undefined, undefined);
  assert.deepEqual(formErrors(schema, f), {
    name: 'A short name, e.g. Allow-WireGuard.',
    open: 'Add the ports it needs, or tick to open every port.',
  });
  const named = { ...f, name: 'Allow-WireGuard', proto: ['udp'] };
  assert.deepEqual(formErrors(schema, { ...named, openAll: true }), {});
  assert.deepEqual(
    formErrors(schema, { ...named, conds: { dest_port: { include: ['51820'], exclude: [], excluding: false } } }),
    {},
  );
});

test('a rule’s conditions: values that don’t fit, ports without a protocol that has them, the family', () => {
  const schema = ruleFormSchema(cfg);
  const f = { ...formOf(undefined, undefined, undefined), name: 'x', openAll: true };
  assert.equal(
    formErrors(schema, { ...f, conds: { dest_port: { include: ['http'], exclude: [], excluding: false } } })['dest_port'],
    '“http” doesn’t fit here.',
  );
  assert.equal(
    formErrors(schema, { ...f, proto: ['icmp'], conds: { dest_port: { include: ['80'], exclude: [], excluding: false } } })[
      'dest_port'
    ],
    'Ports need TCP or UDP (or SCTP) as the protocol.',
  );
  assert.equal(
    formErrors(schema, { ...f, family: 'ipv4', conds: { src_ip: { include: ['2001:db8::1'], exclude: [], excluding: false } } })[
      'src_ip'
    ],
    'Only IPv4 addresses: the rule is for that only.',
  );
  assert.equal(formErrors(schema, { ...f, limit: 'fast' })['limit'], 'A rate like 10/second or 100/minute.');
  assert.equal(
    formErrors(schema, { ...f, src: '@router', dest: '@router' })['path'],
    'From the router to the router isn’t something a rule can match.',
  );
});

test('a NAT rule: a name, single addresses, a source address for SNAT', () => {
  const f = natFormOf(undefined, cfg);
  assert.deepEqual(formErrors(natFormSchema, f), {
    name: 'A short name.',
    snatIp: 'The address to send from, e.g. 203.0.113.9.',
  });
  assert.deepEqual(formErrors(natFormSchema, { ...f, name: 'Office', snatIp: '203.0.113.9', srcIp: '10.0.0.1 10.0.0.2' }), {
    srcIp: 'One address or network.',
  });
  assert.deepEqual(formErrors(natFormSchema, { ...f, name: 'Office', target: 'MASQUERADE', proto: 'tcp', destPort: '0' }), {
    destPort: 'A port (1–65535) or a range like 8000-8010.',
  });
});

test('a new zone needs a name fw4 takes that no zone has; an existing zone keeps its own', () => {
  const form: ZoneForm = {
    name: '',
    networks: [],
    input: 'REJECT',
    output: 'ACCEPT',
    forward: 'REJECT',
    masq: false,
    mtuFix: false,
    to: [],
    from: [],
  };
  assert.equal(
    formErrors(zoneFormSchema(undefined, cfg), form)['name'],
    'Up to 11 letters, digits and _, starting with a letter.',
  );
  assert.equal(
    formErrors(zoneFormSchema(undefined, cfg), { ...form, name: 'lan' })['name'],
    'There’s a zone with that name already.',
  );
  assert.deepEqual(formErrors(zoneFormSchema(undefined, cfg), { ...form, name: 'iot' }), {});
  assert.deepEqual(formErrors(zoneFormSchema(cfg.zones[0], cfg), { ...form, name: 'lan' }), {});
});

test('the defaults: the SYN rate is checked once it’s changed', () => {
  const was = defaultsFormOf(cfg.defaults);
  const schema = defaultsFormSchema(was);
  assert.deepEqual(formErrors(schema, was), {});
  assert.equal(formErrors(schema, { ...was, synRate: 'lots' })['synRate'], 'A whole number of new connections a second.');
});
