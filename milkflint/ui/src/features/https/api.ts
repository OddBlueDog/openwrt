import { z } from 'zod';
import { getConfig } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import { configOf, type HttpsConfig } from './model';

const statusSchema = z.object({
  /** uhttpd's TLS library (libustream-ssl) is installed. */
  tls: z.boolean(),
  /** Something to make a certificate with (px5g, from luci-ssl, or openssl). */
  generator: z.boolean(),
  /** The certificate is the one uhttpd made (/etc/uhttpd.crt), so a new one can replace it. */
  own: z.boolean(),
  cert: z
    .object({
      /** DER, base64. */
      der: z.string(),
      /** SHA-256 of the DER bytes, hex: the fingerprint browsers show. */
      sha256: z.string().nullish(),
      /** When the file was written (seconds since 1970). */
      modified: z.number().nullish(),
    })
    .nullish(),
  /** What the running uhttpd does: */
  running: z.boolean(),
  /** ... the addresses it serves HTTPS on (none: no HTTPS, e.g. no certificate). */
  https: z.array(z.string()),
  /** ... whether it sends HTTP requests on to HTTPS. */
  redirect: z.boolean(),
});
export type HttpsStatus = z.output<typeof statusSchema>;

export function getHttpsStatus(): Promise<HttpsStatus> {
  return call('milkflint.https', 'status', {}, statusSchema);
}

/** uhttpd's settings; undefined when its main section is gone. */
export async function getHttpsConfig(): Promise<HttpsConfig | undefined> {
  return configOf(await getConfig('uhttpd'));
}

/** Replace the router's certificate with a new one; uhttpd restarts a second after it answers. */
export async function renewCertificate(): Promise<void> {
  const r = await call('milkflint.https', 'renew', {}, z.object({ renewing: z.boolean().optional(), error: z.string().optional() }));
  if (r.error !== undefined) throw new Error(`The router couldn’t: ${r.error}.`);
}
