// What the pages whose settings hardware offloading with Wireless Ethernet
// Dispatch (./wed.ts) turns off or passes by show while it's on (./use-wed.ts
// tells them, and gives them what turns it off again with their own save).
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { ZapIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * The notice a page shows while WED is on: what it did to this page's
 * settings, with the way back. turningOff: the page's unsaved changes turn
 * WED off when they're saved.
 */
export function WedNotice({
  title,
  children,
  turningOff = false,
}: {
  title: string;
  children: ReactNode;
  turningOff?: boolean;
}): ReactElement {
  return (
    <Alert variant={turningOff ? 'warning' : 'info'}>
      <ZapIcon />
      <AlertTitle>{turningOff ? 'Saving turns hardware offloading (WED) off' : title}</AlertTitle>
      <AlertDescription>
        <span>
          {children}{' '}
          {turningOff ? (
            'What it had turned off comes back as it was. The Wi-Fi driver lets go of WED when the router next restarts.'
          ) : (
            <Link {...pageLink('tuning')} className="font-medium text-primary underline">
              Performance tuning
            </Link>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
