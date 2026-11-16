import { KeyRoundIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { href } from '@/lib/router';

/**
 * A slim reminder above every page while the router has no admin password
 * (or still the old default). It stays until one is set, but takes one line,
 * on a phone too (the why is on Router access, and on wider screens here),
 * and isn't announced as an alert on every page.
 */
export function PasswordBar({ password }: { password: 'none' | 'old-default' }): ReactElement {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-sm">
      <KeyRoundIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 truncate sm:whitespace-normal">
        <span className="font-semibold">{password === 'none' ? 'No admin password.' : 'Still the default admin password.'}</span>
        <span className="hidden sm:inline"> Anyone on your network can change these settings.</span>
      </p>
      <a
        href={href('admin-password')}
        className="shrink-0 font-semibold text-foreground underline underline-offset-2 hover:no-underline"
      >
        {password === 'none' ? 'Set one' : 'Change it'}
      </a>
    </div>
  );
}
