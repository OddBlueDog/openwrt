// rpcd plugin for the "https" feature: whether this page and LuCI answer
// over HTTPS, and the router's own certificate. uhttpd's init script makes a
// self-signed certificate with px5g (luci-ssl) the first time it starts with
// listen_https set, and serves HTTPS only once it has one; what it actually
// runs with is in procd's instance (-s: an HTTPS address, -q: redirect).
// The settings themselves (listen_https, redirect_https) are uci's.
'use strict';

import { access, readfile, stat, unlink, writefile, popen } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';

// where uhttpd's init script puts the certificate it makes
const OWN_CERT = '/etc/uhttpd.crt';
const OWN_KEY = '/etc/uhttpd.key';
// the certificate as DER, for sha256sum (rpcd runs one call at a time)
const SCRATCH = '/tmp/milkflint-https.der';

function files() {
	const c = cursor();
	return {
		cert: c.get('uhttpd', 'main', 'cert') ?? OWN_CERT,
		key: c.get('uhttpd', 'main', 'key') ?? OWN_KEY
	};
}

// What the running uhttpd serves: its HTTPS addresses and whether it
// redirects, from every instance's command line (one per uhttpd section).
function running() {
	const bus = connect();
	const svc = bus?.call('service', 'list', { name: 'uhttpd' });
	bus?.disconnect();
	const out = { running: false, https: [], redirect: false };
	for (let name, inst in svc?.uhttpd?.instances ?? {}) {
		if (!inst?.running)
			continue;
		out.running = true;
		const cmd = inst.command ?? [];
		for (let i = 0; i < length(cmd); i++) {
			if (cmd[i] == '-s' && type(cmd[i + 1]) == 'string')
				push(out.https, cmd[++i]);
			else if (cmd[i] == '-q')
				out.redirect = true;
		}
	}
	return out;
}

// The certificate's DER bytes: px5g writes DER; a certificate put there by
// hand (or by acme) may be PEM, whose first certificate is the server's.
function der(data) {
	if (data == null || length(data) == 0)
		return null;
	const pem = match(data, /-----BEGIN CERTIFICATE-----([A-Za-z0-9+\/=\r\n\t ]+)-----END CERTIFICATE-----/);
	if (pem)
		return b64dec(replace(pem[1], /[\r\n\t ]/g, ''));
	return (ord(data, 0) == 0x30) ? data : null;
}

// SHA-256 of the DER bytes: the fingerprint a browser shows for it
function fingerprint(bytes) {
	if (!writefile(SCRATCH, bytes))
		return null;
	const p = popen(`sha256sum ${SCRATCH} 2>/dev/null`, 'r');
	const line = p?.read('line') ?? '';
	p?.close();
	unlink(SCRATCH);
	const m = match(line, /^([0-9a-f]{64})\s/);
	return m ? m[1] : null;
}

function generator() {
	return access('/usr/sbin/px5g', 'x') || access('/usr/bin/openssl', 'x');
}

return {
	'milkflint.https': {
		status: {
			call: function() {
				const f = files();
				const bytes = der(readfile(f.cert));
				const st = stat(f.cert);
				return {
					// uhttpd's TLS library (libustream-ssl) and something to make a certificate with
					tls: access('/lib/libustream-ssl.so') == true,
					generator: generator() == true,
					// the certificate is the one uhttpd made, so a new one can replace it
					own: f.cert == OWN_CERT && f.key == OWN_KEY,
					cert: bytes == null ? null : {
						der: b64enc(bytes),
						sha256: fingerprint(bytes),
						modified: st?.mtime
					},
					...running()
				};
			}
		},
		// A new self-signed certificate: the old one goes and uhttpd's init
		// script makes another as it starts. Only uhttpd's own, and only with
		// px5g there to make the next. A second later, so this answer gets out
		// before uhttpd restarts.
		renew: {
			call: function() {
				const f = files();
				if (f.cert != OWN_CERT || f.key != OWN_KEY)
					return { error: 'not the router’s own certificate' };
				if (!generator())
					return { error: 'nothing to make a certificate with' };
				system(`(sleep 1; rm -f ${OWN_CERT} ${OWN_KEY}; /etc/init.d/uhttpd restart) > /dev/null 2>&1 &`);
				return { renewing: true };
			}
		}
	}
};
