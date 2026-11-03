// The DNS page's "Your devices' DNS server": the home network's DHCP options
// it reads and writes, as LuCI's DHCP server tabs keep them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DeviceDns, deviceDnsChanges, homeDhcp, loops, readDeviceDns, validateDeviceDns } from '../src/features/dns/device-dns.ts';
import type { Section } from '../src/lib/api/uci.ts';

const lan = (values: Record<string, string | string[]> = {}): Section => ({ '.name': 'lan', '.type': 'dhcp', interface: 'lan', ...values });
const own = (ipv4: string, ipv6 = ''): DeviceDns => ({ own: true, ipv4, ipv6 });
const router: DeviceDns = { own: false, ipv4: '', ipv6: '' };

test('stock settings: devices ask the router', () => {
  assert.deepEqual(readDeviceDns(lan()), router);
  assert.deepEqual(readDeviceDns(undefined), router);
});

test('reads what LuCI writes: option 6 or its name, several addresses, IPv6 announced servers', () => {
  assert.deepEqual(readDeviceDns(lan({ dhcp_option: ['3,192.168.1.1', '6,192.168.1.53,192.168.1.54'] })), own('192.168.1.53, 192.168.1.54'));
  assert.deepEqual(readDeviceDns(lan({ dhcp_option: 'option:dns-server,192.168.1.53' })), own('192.168.1.53'));
  assert.deepEqual(readDeviceDns(lan({ dns: ['fd00::53'] })), own('', 'fd00::53'));
});

test('options with a tag are not the home network’s server', () => {
  assert.deepEqual(readDeviceDns(lan({ dhcp_option: ['tag:kids,6,192.168.1.60'] })), router);
});

test('the home network’s DHCP section is found by its interface', () => {
  const dhcp: Section[] = [{ '.name': 'cfg01', '.type': 'dnsmasq' }, { '.name': 'guest', '.type': 'dhcp', interface: 'guest' }, lan()];
  assert.equal(homeDhcp(dhcp)?.['.name'], 'lan');
});

test('another server: option 6 for IPv4, and the router no longer offered over IPv6', () => {
  assert.deepEqual(deviceDnsChanges('lan', lan(), own('192.168.1.53')), [
    { op: 'set', config: 'dhcp', section: 'lan', values: { dhcp_option: ['6,192.168.1.53'], dns_service: '0' } },
  ]);
});

test('with an IPv6 address, that is announced instead', () => {
  assert.deepEqual(deviceDnsChanges('lan', lan(), own('192.168.1.53, 192.168.1.54', 'fd00::53')), [
    { op: 'set', config: 'dhcp', section: 'lan', values: { dhcp_option: ['6,192.168.1.53,192.168.1.54'], dns: ['fd00::53'] } },
  ]);
});

test('other DHCP options and tagged ones stay, in order; an old DNS option is replaced', () => {
  const before = lan({ dhcp_option: ['3,192.168.1.1', 'option:dns-server,192.168.1.9', 'tag:kids,6,192.168.1.60'] });
  assert.deepEqual(deviceDnsChanges('lan', before, own('192.168.1.53')), [
    { op: 'set', config: 'dhcp', section: 'lan', values: { dhcp_option: ['3,192.168.1.1', 'tag:kids,6,192.168.1.60', '6,192.168.1.53'], dns_service: '0' } },
  ]);
});

test('back to the router: the page’s options come out, others stay', () => {
  const before = lan({ dhcp_option: ['3,192.168.1.1', '6,192.168.1.53'], dns_service: '0' });
  assert.deepEqual(deviceDnsChanges('lan', before, router), [
    { op: 'set', config: 'dhcp', section: 'lan', values: { dhcp_option: ['3,192.168.1.1'] } },
    { op: 'unset', config: 'dhcp', section: 'lan', options: ['dns_service'] },
  ]);
  assert.deepEqual(deviceDnsChanges('lan', lan({ dhcp_option: ['6,192.168.1.53'], dns: ['fd00::53'] }), router), [
    { op: 'unset', config: 'dhcp', section: 'lan', options: ['dhcp_option', 'dns'] },
  ]);
});

test('left on the router, nothing is written: LuCI’s own IPv6 DNS choice stays', () => {
  assert.deepEqual(deviceDnsChanges('lan', lan({ dns_service: '0' }), router), []);
});

test('unchanged, nothing is written', () => {
  const before = lan({ dhcp_option: ['6,192.168.1.53'], dns_service: '0' });
  assert.deepEqual(deviceDnsChanges('lan', before, readDeviceDns(before)), []);
});

test('addresses: on the home network, not the router, at least one', () => {
  assert.deepEqual(validateDeviceDns(own('192.168.1.53'), '192.168.1.1', 24), {});
  assert.deepEqual(validateDeviceDns(own('', 'fd00::53'), '192.168.1.1', 24), {});
  assert.ok(validateDeviceDns(own(''), '192.168.1.1', 24).ipv4 !== undefined);
  assert.ok(validateDeviceDns(own('192.168.1.1'), '192.168.1.1', 24).ipv4?.includes('router') === true);
  assert.ok(validateDeviceDns(own('8.8.8.8'), '192.168.1.1', 24).ipv4?.includes('home network') === true);
  assert.ok(validateDeviceDns(own('192.168.1.300'), '192.168.1.1', 24).ipv4 !== undefined);
  assert.ok(validateDeviceDns(own('192.168.1.53', '192.168.1.54'), '192.168.1.1', 24).ipv6 !== undefined);
  assert.deepEqual(validateDeviceDns(router, '192.168.1.1', 24), {});
});

test('a loop: the router’s plain DNS server is the devices’ server', () => {
  assert.ok(loops(own('192.168.1.53'), ['192.168.1.53']));
  assert.ok(loops(own('192.168.1.53'), ['192.168.1.53#53']));
  assert.ok(!loops(own('192.168.1.53'), ['9.9.9.9']));
  assert.ok(!loops(router, ['192.168.1.53']));
});
