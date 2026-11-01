import { CheckIcon, CopyIcon, QrCodeIcon, RefreshCwIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { QrCode } from '@/components/qr-code';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { errorMessage } from '@/lib/utils';
import { codeText, joinUrl } from './join-link';

/** How other devices join: the QR code (a camera opens the join page), or the code typed on the router's sign-in page. */
export function InviteCard({
  token,
  code,
  codeDisabled,
  onNewCode,
}: {
  token: string;
  code: string;
  codeDisabled: boolean;
  /** the admin's: a new token and code (the old ones stop working) */
  onNewCode: (() => Promise<void>) | undefined;
}): ReactElement {
  const url = joinUrl(token);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // the clipboard needs a secure page (HTTPS); over plain HTTP the link is selected for copying instead
  const canCopy = window.isSecureContext && 'clipboard' in navigator;
  const renew = async (): Promise<void> => {
    if (onNewCode === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await onNewCode();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeading icon={QrCodeIcon} title="Add a device" description="Scan the code with the device's camera, or type the code on the router's sign-in page" />
      <CardContent className="flex flex-col items-center gap-4">
        <QrCode text={url} label="QR code to join the bench" className="size-44 rounded-lg border sm:size-52" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-muted-foreground">Code</span>
          <span className="font-mono text-2xl font-semibold tracking-[0.2em] tabular" aria-label={`Code ${code.split('').join(' ')}`}>
            {codeText(code)}
          </span>
        </div>
        {codeDisabled && (
          <Alert variant="warning">
            <AlertDescription>Too many wrong codes were tried, so this code no longer works. The QR code still does.</AlertDescription>
          </Alert>
        )}
        <div className="flex w-full min-w-0 items-center gap-2">
          <input
            readOnly
            aria-label="Join link"
            value={url}
            onFocus={(e) => {
              e.target.select();
            }}
            className="h-8 min-w-0 flex-1 rounded-md border bg-muted/40 px-2 font-mono text-[11px] text-muted-foreground"
          />
          {canCopy && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 2000);
                });
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </div>
        {onNewCode !== undefined && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void renew()} className="text-muted-foreground">
            <RefreshCwIcon /> New code
          </Button>
        )}
        {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
