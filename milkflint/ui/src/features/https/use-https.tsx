// What the HTTPS part of Router access reads and does: uhttpd's settings
// and what the running web server does, the form, the save and a new
// certificate; and the answer it gives at the top of the page.
import { ChevronRightIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { type ApplyState, useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { href } from '@/lib/router';
import { UnreachableError } from '@/lib/ubus';
import { errorMessage } from '@/lib/utils';
import { getHttpsConfig, getHttpsStatus, type HttpsStatus, renewCertificate } from './api';
import { type Certificate, formatFingerprint, fromBase64, parseCertificate } from './certificate';
import { formOf, type HttpsConfig, type HttpsForm, moveTo, pageUrl, toChanges } from './model';

export interface Loaded {
  config: HttpsConfig | undefined;
  status: HttpsStatus;
}

/** The settings and what uhttpd runs with. uhttpd restarts a moment after a save or a new certificate: then this waits for it. */
async function load(): Promise<Loaded> {
  for (let attempt = 1; ; attempt++) {
    try {
      const [config, status] = await Promise.all([getHttpsConfig(), getHttpsStatus()]);
      return { config, status };
    } catch (err) {
      if (!(err instanceof UnreachableError) || attempt >= 8) throw err;
      await new Promise((r) => window.setTimeout(r, 1000));
    }
  }
}

export type Renew =
  { phase: 'idle' | 'confirm' | 'busy' } | { phase: 'done'; https: boolean } | { phase: 'failed'; message: string };

/** Why this firmware can't serve HTTPS. */
export function cantServeText(s: HttpsStatus): string {
  return s.tls
    ? 'This firmware has no certificate and nothing to make one with: px5g, from the luci-ssl package, isn’t installed.'
    : 'This firmware lacks uhttpd’s TLS library (libustream-mbedtls, from the luci-ssl package).';
}

/** HTTPS works with this firmware: the TLS library, and a certificate or a way to make one. */
export function canServe(s: HttpsStatus): boolean {
  return s.tls && (s.generator || (s.cert !== undefined && s.cert !== null));
}

export interface Https {
  data: Loaded | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** The form as edited, or as saved. */
  form: HttpsForm | undefined;
  dirty: boolean;
  set: <K extends keyof HttpsForm>(key: K, value: HttpsForm[K]) => void;
  revert: () => void;
  save: () => void;
  state: ApplyState;
  renew: Renew;
  setRenew: (r: Renew) => void;
  startRenew: () => void;
  parsed: Certificate | undefined;
  fingerprint: string | undefined;
}

/** Everything the HTTPS part of the page reads and does, for its answer, its cards and the save bar. */
export function useHttps(): Https {
  const { data, error, loading, reload } = useLoad(load);
  const [edit, setEdit] = useState<HttpsForm>();
  // uhttpd restarts a second or so after a save: look again after that
  const onApplied = useCallback(() => {
    setEdit(undefined);
    window.setTimeout(reload, 2500);
  }, [reload]);
  const { state, apply, applyAndMove, reset } = useApply(onApplied);
  const [renew, setRenew] = useState<Renew>({ phase: 'idle' });
  const config = data?.config;
  const saved = config === undefined ? undefined : formOf(config);
  const form = edit ?? saved;
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(saved);
  const set = <K extends keyof HttpsForm>(key: K, value: HttpsForm[K]): void => {
    if (saved !== undefined) setEdit({ ...(edit ?? saved), [key]: value });
    reset();
  };
  const save = (): void => {
    if (form === undefined || config === undefined) return;
    const changes = toChanges(form, config);
    const next = moveTo(form, config, window.location);
    void (next === undefined ? apply(changes) : applyAndMove(changes, next));
  };
  const startRenew = (): void => {
    setRenew({ phase: 'busy' });
    renewCertificate().then(
      () => {
        const https = window.location.protocol === 'https:';
        setRenew({ phase: 'done', https });
        // over HTTP the page carries on: show the new one once uhttpd has made it
        if (!https) window.setTimeout(reload, 4000);
      },
      (err: unknown) => {
        setRenew({ phase: 'failed', message: errorMessage(err) });
      },
    );
  };
  const cert = data?.status.cert;
  return {
    data,
    error,
    loading,
    reload,
    form,
    dirty,
    set,
    revert: () => {
      setEdit(undefined);
    },
    save,
    state,
    renew,
    setRenew,
    startRenew,
    parsed: cert === undefined || cert === null ? undefined : parseCertificate(fromBase64(cert.der)),
    fingerprint: cert?.sha256 === undefined || cert.sha256 === null ? undefined : formatFingerprint(cert.sha256),
  };
}

const link = 'link inline-flex w-fit items-center gap-0.5 text-sm font-medium underline-offset-4';

/** The address this page answers at over HTTPS, without the page's own path. */
function siteOf(status: HttpsStatus): string {
  return pageUrl('https', window.location.hostname, status.https).replace(/milkflint\/#\/https$/, '');
}

/**
 * The answer about HTTPS: on or off, whether the web server serves it now,
 * and what to do when it can't. For the page's opening card.
 */
export function httpsAnswer(h: Https): { badge: ReactElement; text: ReactNode; next?: ReactNode } {
  const status = h.data?.status;
  const config = h.data?.config;
  if (status === undefined) return { badge: <Badge variant="secondary">Checking</Badge>, text: 'Asking the web server…' };
  if (config === undefined) {
    return {
      badge: <Badge variant="warning">No settings</Badge>,
      text: 'uhttpd, the router’s web server, has no settings: its main section is missing from /etc/config/uhttpd. Put it back by hand, or restore a backup.',
      next: (
        <a href={href('backup-reset')} className={link}>
          Backup &amp; reset
          <ChevronRightIcon className="size-4" />
        </a>
      ),
    };
  }
  if (!canServe(status)) {
    return {
      badge: <Badge variant="warning">Can’t serve HTTPS</Badge>,
      text: `${cantServeText(status)} MilkFlint’s releases include it.`,
      next: (
        <a href={href('upgrade')} className={link}>
          Upgrade
          <ChevronRightIcon className="size-4" />
        </a>
      ),
    };
  }
  if (!formOf(config).https)
    return { badge: <Badge variant="secondary">Off</Badge>, text: 'This page and LuCI answer over HTTP only.' };
  if (status.https.length === 0) {
    return {
      badge: <Badge variant="warning">Not answering yet</Badge>,
      text: 'The web server makes its certificate as it starts, so a restart of the router (or of uhttpd) brings HTTPS up.',
      next: (
        <a href={href('backup-reset')} className={link}>
          Restart the router
          <ChevronRightIcon className="size-4" />
        </a>
      ),
    };
  }
  const site = siteOf(status);
  return {
    badge: <Badge variant="success">On</Badge>,
    text: (
      <>
        This page and LuCI answer at{' '}
        {window.location.protocol === 'https:' ? (
          <span className="font-mono text-foreground">{site}</span>
        ) : (
          <a
            href={pageUrl('https', window.location.hostname, status.https)}
            className="font-mono font-medium text-primary underline"
          >
            {site}
          </a>
        )}
        {status.redirect ? ', and HTTP sends people there.' : ' as well as over HTTP.'}
      </>
    ),
  };
}
