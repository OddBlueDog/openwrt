// HTTPS on the Router access page: whether this page and LuCI answer over
// HTTPS, "Always use HTTPS", and the certificate browsers are shown. uhttpd
// keeps the settings (/etc/config/uhttpd, section main); the router side
// (milkflint.https) says what the running web server does and makes a new
// certificate. #/https lands here.
import { InfoIcon, LoaderCircleIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { canServe, cantServeText, type Https } from './use-https';
import { href } from '@/lib/router';

const date = (d: Date): string => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The HTTPS settings; `id` is where #/https scrolls to. */
export function HttpsCard({ h, id }: { h: Https; id: string }): ReactElement | null {
  const { data, form } = h;
  const config = data?.config;
  const status = data?.status;
  if (form === undefined || config === undefined || status === undefined) return null;
  const serve = canServe(status);
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeading
        title="HTTPS"
        description="An encrypted connection to these pages and LuCI, with the router’s own certificate. On by default, as on OpenWrt."
        action={
          <Switch
            checked={form.https}
            // the firmware can't serve it: it can be turned off, not on
            disabled={!serve && !form.https}
            onCheckedChange={(v) => {
              h.set('https', v);
            }}
            aria-label="HTTPS on"
          />
        }
      />
      <CardContent className="flex flex-col gap-3">
        <div className="divide-y border-t">
          <Field
            id="https-redirect"
            label="Always use HTTPS"
            hint="Opening the router’s HTTP address sends you on to HTTPS."
            why={
              <>
                Off, HTTP keeps working beside HTTPS. On, every request to the HTTP address is answered with a redirect to HTTPS,
                so nothing you type here crosses the network unencrypted. It’s LuCI’s Redirect to HTTPS: uhttpd’s{' '}
                <span className="font-mono">redirect_https</span> option.
              </>
            }
          >
            <Switch
              id="https-redirect"
              checked={form.https && form.redirect}
              disabled={!form.https || !serve}
              onCheckedChange={(v) => {
                h.set('redirect', v);
              }}
            />
          </Field>
        </div>
        {!serve && (
          <Note
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={form.https ? 'Set to on, but not served' : 'Can’t be turned on here'}
            className="border-t pt-3"
          >
            {cantServeText(status)}{' '}
            <a href={href('upgrade')} className="font-medium link underline-offset-4">
              Upgrade
            </a>{' '}
            to a MilkFlint release, which includes it.
          </Note>
        )}
        {serve && form.https && (
          <Note tone="info" icon={<InfoIcon />} className="border-t pt-3">
            The first time, your browser warns that the connection isn’t private: the certificate is the router’s own, not one
            from an authority browsers know. Check that the fingerprint it shows matches the one under Certificate, then continue.
            Each address (and each browser) asks once.
          </Note>
        )}
      </CardContent>
    </Card>
  );
}

/** The certificate browsers are shown, and a new one on request. */
export function CertificateCard({ h }: { h: Https }): ReactElement | null {
  const { parsed, fingerprint, renew } = h;
  const status = h.data?.status;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  if (status === undefined || h.data?.config === undefined) return null;
  const canRenew = status.own && status.generator;
  const present = status.cert !== undefined && status.cert !== null;
  const expired = parsed !== undefined && parsed.notAfter.getTime() < now;
  return (
    <Card>
      <CardHeading
        title="Certificate"
        description="What your browser is shown when it connects over HTTPS."
        action={
          canRenew ? (
            <Button
              variant="outline"
              size="sm"
              disabled={renew.phase === 'busy'}
              onClick={() => {
                h.setRenew({ phase: 'confirm' });
              }}
            >
              {renew.phase === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
              Make a new one
            </Button>
          ) : undefined
        }
      />
      <CardContent className="flex flex-col gap-3">
        {renew.phase === 'done' && (
          <Note tone="success" icon={<RefreshCwIcon />} title="New certificate on its way">
            {renew.https ? (
              <>
                This page loses its connection while the web server restarts.{' '}
                <button
                  type="button"
                  className="cursor-pointer font-medium text-primary underline"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Reload it
                </button>{' '}
                in a few seconds: your browser asks about the new certificate, and you sign in again.
              </>
            ) : (
              'The web server restarts with it in a few seconds; its fingerprint shows here then.'
            )}
          </Note>
        )}
        {renew.phase === 'failed' && (
          <Note tone="destructive" icon={<TriangleAlertIcon />} title="Couldn’t make a new certificate">
            {renew.message}
          </Note>
        )}
        {!present ? (
          <p className="text-sm text-muted-foreground">None yet. The web server makes one as it starts with HTTPS on.</p>
        ) : (
          <div className="flex flex-col">
            {fingerprint !== undefined && (
              <div className="flex flex-col gap-1 border-b py-2.5 text-sm">
                <span className="text-muted-foreground">Fingerprint (SHA-256)</span>
                <span className="font-mono text-xs break-all">{fingerprint}</span>
              </div>
            )}
            {parsed === undefined ? (
              <InfoRow label="Details">Not a certificate this page can read</InfoRow>
            ) : (
              <div className="grid gap-x-8 sm:grid-cols-2 [&>*:last-child]:border-b-0 sm:[&>*:nth-last-child(2)]:border-b-0">
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
              </div>
            )}
          </div>
        )}
        {expired && canRenew && (
          <p className="text-sm text-muted-foreground">Browsers warn about an expired certificate: make a new one.</p>
        )}
      </CardContent>
      <Dialog
        open={renew.phase === 'confirm'}
        onOpenChange={(open) => {
          if (!open) h.setRenew({ phase: 'idle' });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a new certificate?</DialogTitle>
            <DialogDescription>
              The router replaces its certificate and restarts its web server, which takes a few seconds. Browsers that accepted
              the old one ask again, with the new fingerprint.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                h.setRenew({ phase: 'idle' });
              }}
            >
              Cancel
            </Button>
            <Button onClick={h.startRenew}>Make a new one</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** After a save that moves this page to the other protocol: where it carries on. */
export function Moved({ url, fingerprint }: { url: string; fingerprint: string | undefined }): ReactElement {
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
