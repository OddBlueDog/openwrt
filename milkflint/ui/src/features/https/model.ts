// The HTTPS page's settings, as uhttpd keeps them (/etc/config/uhttpd,
// section main): listen_https, the addresses it serves HTTPS on (OpenWrt's
// default: port 443 on every address), and redirect_https, which sends HTTP
// requests on to HTTPS (LuCI's "Redirect to HTTPS").
import { bool, type Change, list, type Section } from '@/lib/api/uci';

/** OpenWrt's own listen_https: port 443 on every IPv4 and IPv6 address. */
export const DEFAULT_LISTEN = ['0.0.0.0:443', '[::]:443'];

export interface HttpsConfig {
  /** listen_https: none means HTTPS is off. */
  listen: string[];
  /** listen_http. */
  listenHttp: string[];
  redirect: boolean;
}

export interface HttpsForm {
  https: boolean;
  /** Always use HTTPS: HTTP requests are sent on to it. */
  redirect: boolean;
}

export function configOf(sections: readonly Section[]): HttpsConfig | undefined {
  const s = sections.find((x) => x['.name'] === 'main');
  if (s === undefined) return undefined;
  return { listen: list(s, 'listen_https'), listenHttp: list(s, 'listen_http'), redirect: bool(s, 'redirect_https') };
}

export function formOf(c: HttpsConfig): HttpsForm {
  const https = c.listen.length > 0;
  return { https, redirect: https && c.redirect };
}

/**
 * The uci changes for a form. Turning HTTPS on gives OpenWrt's addresses
 * back; addresses of one's own stay while it's on. Off takes the redirect
 * with it, as there'd be nothing to send requests on to.
 */
export function toChanges(f: HttpsForm, c: HttpsConfig): Change[] {
  const values: Record<string, string | string[]> = {};
  const redirect = f.https && f.redirect;
  if (f.https && c.listen.length === 0) values['listen_https'] = DEFAULT_LISTEN;
  if (redirect !== c.redirect) values['redirect_https'] = redirect ? '1' : '0';
  const changes: Change[] = [];
  if (Object.keys(values).length > 0) changes.push({ op: 'set', config: 'uhttpd', section: 'main', values });
  if (!f.https && c.listen.length > 0) changes.push({ op: 'unset', config: 'uhttpd', section: 'main', options: ['listen_https'] });
  return changes;
}

/** The port of a uhttpd listen address ("0.0.0.0:443", "[::]:443", "8443"). */
export function portOf(listen: string): number | undefined {
  const m = /(?:^|:)(\d+)$/.exec(listen);
  const port = m === null ? NaN : Number(m[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

/** The page's address over a protocol, on a router listening there: the default port left out. */
export function pageUrl(protocol: 'http' | 'https', host: string, listen: readonly string[]): string {
  const port = listen.map(portOf).find((p) => p !== undefined);
  const standard = protocol === 'https' ? 443 : 80;
  return `${protocol}://${host}${port === undefined || port === standard ? '' : `:${String(port)}`}/milkflint/#/https`;
}

/**
 * Where this page carries on once a form is saved, when saving takes away
 * the protocol it's on: HTTPS turned off under an HTTPS page, or "Always
 * use HTTPS" turned on under an HTTP one (its next request would be sent to
 * HTTPS, a different site to the browser). Undefined when it stays.
 */
export function moveTo(f: HttpsForm, c: HttpsConfig, page: { protocol: string; hostname: string }): string | undefined {
  if (page.protocol === 'https:' && !f.https) return pageUrl('http', page.hostname, c.listenHttp);
  if (page.protocol === 'http:' && f.https && f.redirect) return pageUrl('https', page.hostname, c.listen.length > 0 ? c.listen : DEFAULT_LISTEN);
  return undefined;
}
