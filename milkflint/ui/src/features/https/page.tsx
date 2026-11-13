import { BadgeCheckIcon, InfoIcon, LoaderCircleIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { UnreachableError } from '@/lib/ubus';
import { errorMessage } from '@/lib/utils';
import { getHttpsConfig, getHttpsStatus, type HttpsStatus, renewCertificate } from './api';
import { type Certificate, formatFingerprint, fromBase64, parseCertificate } from './certificate';
import { formOf, type HttpsConfig, type HttpsForm, moveTo, pageUrl, toChanges } from './model';

interface Loaded {
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

const date = (d: Date): string => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

type Renew = { phase: 'idle' | 'confirm' | 'busy' } | { phase: 'done'; https: boolean } | { phase: 'failed'; message: string };

export function HttpsPage(): ReactElement {
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

  const status = data?.status;
  const cert = status?.cert;
  const parsed = cert === undefined || cert === null ? undefined : parseCertificate(fromBase64(cert.der));
  const fingerprint = cert?.sha256 === undefined || cert.sha256 === null ? undefined : formatFingerprint(cert.sha256);

  return (
    <>
      <PageHeader title="HTTPS" description="An encrypted connection to this page and LuCI, with the router’s own certificate." />
      <div className="flex flex-col gap-4">
        {state.phase === 'moved' ? <Moved url={state.url} fingerprint={fingerprint} /> : <ApplyStatus state={state} />}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : form === undefined || config === undefined || status === undefined ? (
          <Alert variant="warning">
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>uhttpd, the router’s web server, has no settings (its main section is missing from /etc/config/uhttpd).</AlertDescription>
          </Alert>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,32rem)_1fr]">
            <Card>
              <CardHeading
                icon={LockIcon}
                title="HTTPS"
                description="On by default, as on OpenWrt. HTTP keeps working unless you turn on Always use HTTPS."
                action={
                  <Switch
                    checked={form.https}
                    onCheckedChange={(v) => {
                      set('https', v);
                      reset();
                    }}
                    aria-label="HTTPS on"
                  />
                }
              />
              <CardContent className="flex flex-col gap-3">
                <Serving status={status} https={formOf(config).https} />
                <div className="divide-y border-t">
                  <Field
                    id="https-redirect"
                    label="Always use HTTPS"
                    hint="Anyone who opens the router’s HTTP address is sent on to HTTPS (LuCI’s Redirect to HTTPS)."
                  >
                    <Switch
                      id="https-redirect"
                      checked={form.https && form.redirect}
                      disabled={!form.https || !canServe(status)}
                      onCheckedChange={(v) => {
                        set('redirect', v);
                        reset();
                      }}
                    />
                  </Field>
                </div>
                {form.https && (
                  <Alert variant="info">
                    <InfoIcon />
                    <AlertDescription>
                      The first time, your browser warns that the connection isn’t private: the certificate is the router’s own,
                      not one from an authority browsers know. Check that the fingerprint it shows matches the one here, then
                      continue. Each address (and each browser) asks once.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
            <CertificateCard
              parsed={parsed}
              present={cert !== undefined && cert !== null}
              fingerprint={fingerprint}
              canRenew={status.own && status.generator}
              renew={renew}
              onRenew={() => {
                setRenew({ phase: 'confirm' });
              }}
            />
          </div>
        )}
        <SaveBar
          // once moved, this page's calls go to the other protocol: nothing more to save here
          visible={dirty && state.phase !== 'moved'}
          busy={state.phase === 'applying'}
          invalid={false}
          onSave={save}
          onRevert={() => {
            setEdit(undefined);
          }}
        />
      </div>
      <Dialog
        open={renew.phase === 'confirm'}
        onOpenChange={(open) => {
          if (!open) setRenew({ phase: 'idle' });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a new certificate?</DialogTitle>
            <DialogDescription>
              The router replaces its certificate and restarts its web server, which takes a few seconds. Browsers that
              accepted the old one ask again, with the new fingerprint.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRenew({ phase: 'idle' });
              }}
            >
              Cancel
            </Button>
            <Button onClick={startRenew}>Make a new one</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** HTTPS works with this firmware: the TLS library, and a certificate or a way to make one. */
function canServe(s: HttpsStatus): boolean {
  return s.tls && (s.generator || (s.cert !== undefined && s.cert !== null));
}

/** What the running web server does, against what its settings ask for. */
function Serving({ status, https }: { status: HttpsStatus; https: boolean }): ReactElement | null {
  const host = window.location.hostname;
  if (!canServe(status)) {
    return (
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>This firmware can’t serve HTTPS</AlertTitle>
        <AlertDescription>
          {status.tls
            ? 'It has no certificate and nothing to make one with: px5g, from the luci-ssl package, isn’t installed.'
            : 'uhttpd’s TLS library (libustream-mbedtls, from the luci-ssl package) isn’t installed.'}
        </AlertDescription>
      </Alert>
    );
  }
  if (!https) return <p className="text-sm text-muted-foreground">Off: this page and LuCI answer over HTTP only.</p>;
  if (status.https.length === 0) {
    return (
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>Not answering over HTTPS yet</AlertTitle>
        <AlertDescription>
          The web server isn’t serving HTTPS: it makes its certificate as it starts, so a restart of the router (or of
          uhttpd) brings it up.
        </AlertDescription>
      </Alert>
    );
  }
  const url = pageUrl('https', host, status.https);
  return (
    <p className="text-sm text-muted-foreground">
      This page and LuCI answer at{' '}
      {window.location.protocol === 'https:' ? (
        <span className="font-mono text-foreground">{url.replace(/milkflint\/#\/https$/, '')}</span>
      ) : (
        <a href={url} className="font-mono font-medium text-primary underline">
          {url.replace(/milkflint\/#\/https$/, '')}
        </a>
      )}
      {status.redirect ? ', and HTTP sends people there.' : ' as well as over HTTP.'}
    </p>
  );
}

function CertificateCard({
  parsed,
  present,
  fingerprint,
  canRenew,
  renew,
  onRenew,
}: {
  parsed: Certificate | undefined;
  present: boolean;
  fingerprint: string | undefined;
  canRenew: boolean;
  renew: Renew;
  onRenew: () => void;
}): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  const expired = parsed !== undefined && parsed.notAfter.getTime() < now;
  return (
    <Card>
      <CardHeading icon={BadgeCheckIcon} title="Certificate" description="What your browser is shown when it connects over HTTPS." />
      <CardContent className="flex flex-col gap-3">
        {renew.phase === 'done' && (
          <Alert variant="success">
            <AlertTitle>New certificate on its way</AlertTitle>
            <AlertDescription>
              {renew.https ? (
                <>
                  This page loses its connection while the web server restarts.{' '}
                  <button type="button" className="font-medium text-primary underline" onClick={() => {
                      window.location.reload();
                    }}>
                    Reload it
                  </button>{' '}
                  in a few seconds: your browser asks about the new certificate, and you sign in again.
                </>
              ) : (
                'The web server restarts with it in a few seconds; its fingerprint shows here then.'
              )}
            </AlertDescription>
          </Alert>
        )}
        {renew.phase === 'failed' && (
          <Alert variant="destructive">
            <AlertTitle>Couldn’t make a new certificate</AlertTitle>
            <AlertDescription>{renew.message}</AlertDescription>
          </Alert>
        )}
        {!present ? (
          <p className="text-sm text-muted-foreground">None yet. The web server makes one as it starts with HTTPS on.</p>
        ) : (
          <div className="divide-y">
            {fingerprint !== undefined && (
              <div className="flex flex-col gap-1 py-2 text-sm">
                <span className="text-muted-foreground">Fingerprint (SHA-256)</span>
                <span className="font-mono text-xs break-all">{fingerprint}</span>
              </div>
            )}
            {parsed === undefined ? (
              <InfoRow label="Details">Not a certificate this page can read</InfoRow>
            ) : (
              <>
                {parsed.commonName !== undefined && <InfoRow label="Name">{parsed.commonName}</InfoRow>}
                {parsed.altNames.length > 0 && <InfoRow label="For">{parsed.altNames.join(', ')}</InfoRow>}
                <InfoRow label="Issued by">{parsed.selfSigned ? 'Itself (the router)' : 'An authority'}</InfoRow>
                <InfoRow label="Valid from">{date(parsed.notBefore)}</InfoRow>
                <InfoRow label="Valid until">
                  {expired && (
                    <Badge variant="destructive" className="mr-2">
                      Expired
                    </Badge>
                  )}
                  {date(parsed.notAfter)}
                </InfoRow>
              </>
            )}
          </div>
        )}
        {expired && canRenew && (
          <p className="text-sm text-muted-foreground">Browsers warn about an expired certificate: make a new one.</p>
        )}
      </CardContent>
      {canRenew && (
        <CardFooter>
          <Button variant="outline" disabled={renew.phase === 'busy'} onClick={onRenew}>
            {renew.phase === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
            Make a new certificate
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

/** After a save that moves this page to the other protocol: where it carries on. */
function Moved({ url, fingerprint }: { url: string; fingerprint: string | undefined }): ReactElement {
  const https = url.startsWith('https:');
  return (
    <Alert variant="info">
      <LockIcon />
      <AlertTitle>Saved: carry on over {https ? 'HTTPS' : 'HTTP'}</AlertTitle>
      <AlertDescription>
        <p>
          Open{' '}
          <a href={url} className="font-mono font-medium text-primary underline">
            {url}
          </a>{' '}
          and sign in again there.
        </p>
        {https && (
          <p className="mt-1">
            Your browser warns about the router’s certificate the first time.{' '}
            {fingerprint === undefined ? (
              'Its fingerprint is on this page, under Certificate, once you’re in.'
            ) : (
              <>
                Check that the fingerprint it shows is <span className="font-mono text-xs break-all">{fingerprint}</span>, then
                continue.
              </>
            )}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
