// The HTTPS page: reading the router's certificate (its DER bytes), the uci
// changes its switches make, and where the page carries on when a save takes
// away the protocol it's on. Also the address the LAN and Operating Mode
// pages send people to, which follows the page's protocol.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFingerprint, fromBase64, parseCertificate } from '../src/features/https/certificate.ts';
import { configOf, DEFAULT_LISTEN, formOf, type HttpsConfig, moveTo, pageUrl, portOf, toChanges } from '../src/features/https/model.ts';
import type { Section } from '../src/lib/api/uci.ts';
import { routerUrl } from '../src/lib/router-url.ts';

// Made with openssl as uhttpd's init script makes the router's own (px5g's
// options): EC P-256, self-signed, 397 days, DNS:MilkFlint. UTCTime dates.
const OWN =
  'MIIC1zCCAnygAwIBAgIBATAKBggqhkjOPQQDAjBjMQswCQYDVQQGEwJaWjESMBAGA1UECAwJU29tZXdoZXJlMRAwDgYDVQQHDAdVbmtub3duMRowGAYDVQQKDBFNaWxrRmxpbnQxYTJiM2M0ZDESMBAGA1UEAwwJTWlsa0ZsaW50MB4XDTI2MTExMzE1MzI0MFoXDTI3MTIxNTE1MzI0MFowYzELMAkGA1UEBhMCWloxEjAQBgNVBAgMCVNvbWV3aGVyZTEQMA4GA1UEBwwHVW5rbm93bjEaMBgGA1UECgwRTWlsa0ZsaW50MWEyYjNjNGQxEjAQBgNVBAMMCU1pbGtGbGludDCCAUswggEDBgcqhkjOPQIBMIH3AgEBMCwGByqGSM49AQECIQD/////AAAAAQAAAAAAAAAAAAAAAP///////////////zBbBCD/////AAAAAQAAAAAAAAAAAAAAAP///////////////AQgWsY12Ko6k+ez671VdpiGvGUdBrDMU7D2O848PifSYEsDFQDEnTYIhucEk2pmeOETnSa3gZ9+kARBBGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfUCIQD/////AAAAAP//////////vOb6racXnoTzucrC/GMlUQIBAQNCAAQHN4VDPWecme2q7pe42M69OFhVGOueN773oSSJZauBldijzfbbesPlCX6HmKkBO/iDq/YZVztGwjKHlp3brTAKoy0wKzAUBgNVHREEDTALgglNaWxrRmxpbnQwEwYDVR0lBAwwCgYIKwYBBQUHAwEwCgYIKoZIzj0EAwIDSQAwRgIhAInl/H07C3z6ul/jfhsBdDvPt2CKCffTxApHdnlMquD1AiEA87toIL/jRLDu69mKdN1MuO+f0RbqqLOlSQdUSoAYU2M=';
// One an authority (a made-up "Test CA") issued, RSA, valid until 2052
// (GeneralizedTime, as RFC 5280 has dates from 2050), for two names and three
// addresses: 192.168.1.1, fd00::1 and 2001:db8:0:1::1.
const ISSUED =
  'MIIDBTCCAe2gAwIBAgIBBzANBgkqhkiG9w0BAQsFADASMRAwDgYDVQQDDAdUZXN0IENBMCAXDTI2MTExMzE1MzI0MFoYDzIwNTIxMTE2MTUzMjQwWjAkMQ0wCwYDVQQKDARIb21lMRMwEQYDVQQDDApyb3V0ZXIubGFuMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3BJpYemZ/cM6aJ9dlED/RwVFew9dvKy8Xyk5iDdX2Qb4H4RQR1vWnKpDNOdvx6/H+Uw+5nltBXb+phG+SGKI8CgCvP4Vyc7VV50EixIfX0s93tfcM8QQfECgxWgV4aM2VYK9Pf2eHgw5SgkU4vGMshcFZ7+7tB1Cm+f+ALfZYeAqPtp6rSyy10p2tj19ql0TIX0TQX/oa/DSvwBnF/vKQv8z8YQKVQ4hie06h7EAlSXmL3XtRb1BlOBZc7l6plNWbiVjKIJWfEolG2kAfvbtk45diJYZID2FeVU3vI57+jQ9nMaag8t+B2EdjbwOT0KL8LdJUJiZI0vj8YTf92MtqwIDAQABo1IwUDBOBgNVHREERzBFggpyb3V0ZXIubGFugg1taWxrZmxpbnQubGFuhwTAqAEBhxD9AAAAAAAAAAAAAAAAAAABhxAgAQ24AAAAAQAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQC0gEzK3V2cri/ETFHp/4M/tyMChYlTV1ljq7l3koBRtckk/okGIVenmId544EDYiNimRX8Wr0wJ0OWL8lCNuL7mdqYK1SfAOBRiK39fRjewK7CMak6YvL5TiiF41m4fQsVMFMDQtoFbZw8bglbRVjgKgtSUfixZns3RG7lGNQykBYr5Oj98LCq0jnqidKZwCBNc2R6JOaSNuAcqFxXYyMAnxLM4oOu6e0ZU6TGu/cq8CQHsIaNNhYkSfYHPb3V/GNtvIH98vpltzZ0KrgqwhdPBI+O1f/9vMZ3/Em4Hmk9UloJUGUqSEil2jGA5GolD0dmX4BYcx5BOVjS29cuwt2A';

test('the router’s own certificate: its name, dates and that it issued itself', () => {
  assert.deepEqual(parseCertificate(fromBase64(OWN)), {
    commonName: 'MilkFlint',
    altNames: ['MilkFlint'],
    notBefore: new Date('2026-11-13T15:32:40Z'),
    notAfter: new Date('2027-12-15T15:32:40Z'),
    selfSigned: true,
  });
});

test('one an authority issued: a date after 2049, host names before addresses, IPv6 shortened', () => {
  assert.deepEqual(parseCertificate(fromBase64(ISSUED)), {
    commonName: 'router.lan',
    altNames: ['router.lan', 'milkflint.lan', '192.168.1.1', 'fd00::1', '2001:db8:0:1::1'],
    notBefore: new Date('2026-11-13T15:32:40Z'),
    notAfter: new Date('2052-11-16T15:32:40Z'),
    selfSigned: false,
  });
});

test('anything that isn’t a whole certificate gives nothing, never a throw', () => {
  const der = fromBase64(OWN);
  for (let n = 0; n < der.length; n++) assert.equal(parseCertificate(der.subarray(0, n)), undefined, `the first ${String(n)} bytes`);
  assert.equal(parseCertificate(new TextEncoder().encode('-----BEGIN CERTIFICATE-----')), undefined);
  assert.equal(parseCertificate(Uint8Array.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff])), undefined);
  // a byte flipped anywhere: a certificate or nothing
  for (let i = 0; i < der.length; i++) {
    const bad = der.slice();
    bad[i] = (bad[i] ?? 0) ^ 0xff;
    const got = parseCertificate(bad);
    assert.ok(got === undefined || got.notAfter instanceof Date, `byte ${String(i)}`);
  }
});

test('a fingerprint as browsers show it', () => {
  assert.equal(formatFingerprint('5811692f3da9'), '58:11:69:2F:3D:A9');
});

const section = (values: Record<string, string | string[]>): Section[] => [{ '.type': 'uhttpd', '.name': 'main', ...values }];
const stock: HttpsConfig = { listen: DEFAULT_LISTEN, listenHttp: ['0.0.0.0:80', '[::]:80'], redirect: false };

test('uhttpd’s settings, as OpenWrt ships them: HTTPS on, no redirect', () => {
  const c = configOf(section({ listen_https: ['0.0.0.0:443', '[::]:443'], listen_http: ['0.0.0.0:80', '[::]:80'], redirect_https: '0' }));
  assert.deepEqual(c, stock);
  assert.deepEqual(formOf(stock), { https: true, redirect: false });
  assert.equal(configOf([]), undefined);
});

test('a redirect without HTTPS addresses is no redirect', () => {
  assert.deepEqual(formOf({ ...stock, listen: [], redirect: true }), { https: false, redirect: false });
});

test('Always use HTTPS: redirect_https only', () => {
  assert.deepEqual(toChanges({ https: true, redirect: true }, stock), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { redirect_https: '1' } },
  ]);
  assert.deepEqual(toChanges({ https: true, redirect: false }, { ...stock, redirect: true }), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { redirect_https: '0' } },
  ]);
  assert.deepEqual(toChanges(formOf(stock), stock), []);
});

test('HTTPS off takes the addresses and the redirect; on gives OpenWrt’s addresses back', () => {
  assert.deepEqual(toChanges({ https: false, redirect: true }, { ...stock, redirect: true }), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { redirect_https: '0' } },
    { op: 'unset', config: 'uhttpd', section: 'main', options: ['listen_https'] },
  ]);
  const off: HttpsConfig = { ...stock, listen: [] };
  assert.deepEqual(toChanges({ https: true, redirect: false }, off), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { listen_https: ['0.0.0.0:443', '[::]:443'] } },
  ]);
  assert.deepEqual(toChanges({ https: true, redirect: true }, off), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { listen_https: ['0.0.0.0:443', '[::]:443'], redirect_https: '1' } },
  ]);
});

test('addresses of one’s own stay while HTTPS stays on', () => {
  const own: HttpsConfig = { ...stock, listen: ['192.168.1.1:8443'] };
  assert.deepEqual(toChanges({ https: true, redirect: true }, own), [
    { op: 'set', config: 'uhttpd', section: 'main', values: { redirect_https: '1' } },
  ]);
});

test('ports of uhttpd’s listen addresses', () => {
  assert.equal(portOf('0.0.0.0:443'), 443);
  assert.equal(portOf('[::]:8443'), 8443);
  assert.equal(portOf('8443'), 8443);
  assert.equal(portOf('[fd00::1]'), undefined);
  assert.equal(portOf('0.0.0.0:99999'), undefined);
  assert.equal(pageUrl('https', '192.168.1.1', DEFAULT_LISTEN), 'https://192.168.1.1/milkflint/#/https');
  assert.equal(pageUrl('https', '192.168.1.1', ['192.168.1.1:8443']), 'https://192.168.1.1:8443/milkflint/#/https');
  assert.equal(pageUrl('http', '[fd00::1]', ['[::]:80']), 'http://[fd00::1]/milkflint/#/https');
});

test('a save that takes away the page’s protocol says where it carries on', () => {
  const http = { protocol: 'http:', hostname: '192.168.1.1' };
  const https = { protocol: 'https:', hostname: '192.168.1.1' };
  assert.equal(moveTo({ https: true, redirect: true }, stock, http), 'https://192.168.1.1/milkflint/#/https');
  assert.equal(moveTo({ https: false, redirect: false }, stock, https), 'http://192.168.1.1/milkflint/#/https');
  // HTTPS turned on with the redirect: OpenWrt's port
  assert.equal(moveTo({ https: true, redirect: true }, { ...stock, listen: [] }, http), 'https://192.168.1.1/milkflint/#/https');
  // nothing the page is on goes away
  assert.equal(moveTo({ https: true, redirect: false }, stock, http), undefined);
  assert.equal(moveTo({ https: false, redirect: false }, stock, http), undefined);
  assert.equal(moveTo({ https: true, redirect: true }, stock, https), undefined);
  assert.equal(moveTo({ https: true, redirect: false }, stock, https), undefined);
});

test('the LAN and Operating Mode pages send people on over the page’s protocol', () => {
  assert.equal(routerUrl('192.168.2.1', 'https:'), 'https://192.168.2.1/');
  assert.equal(routerUrl('192.168.2.1', 'http:'), 'http://192.168.2.1/');
  // outside a browser (or anything else): HTTP
  assert.equal(routerUrl('192.168.2.1', undefined), 'http://192.168.2.1/');
  assert.equal(routerUrl('192.168.2.1'), 'http://192.168.2.1/');
});
