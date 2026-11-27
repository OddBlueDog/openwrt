// A setting's bands side by side (stacked in a narrow card), each under its
// own heading, so the two bands' choices read across.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { bandLabel, type RadioForm } from '../wifi/model';

export function BandColumns({
  topic,
  forms,
  children,
}: {
  /** For the headings' ids: unique on the page */
  topic: string;
  forms: readonly RadioForm[];
  children: (f: RadioForm) => ReactNode;
}): ReactElement {
  return (
    <div className="@container">
      <div
        className={cn(
          'grid gap-x-8 gap-y-4',
          forms.length > 1 && '@min-[44rem]:grid-cols-2',
          forms.length > 2 && '@min-[72rem]:grid-cols-3',
        )}
      >
        {forms.map((f) => (
          <section key={f.radio} aria-labelledby={`${f.radio}-${topic}`} className="flex min-w-0 flex-col">
            <h3 id={`${f.radio}-${topic}`} className="border-b pb-2 text-sm font-semibold">
              {bandLabel(f.band)}
            </h3>
            <div className="divide-y">{children(f)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Where a band can't have the setting, and what to do about it. */
export function NotHere({ children }: { children: ReactNode }): ReactElement {
  return <p className="py-3.5 text-sm text-muted-foreground">{children}</p>;
}

/** The band's Wi-Fi mode is older than Wi-Fi 6, which the setting needs. */
export function NeedsWifi6(): ReactElement {
  return (
    <NotHere>
      Needs Wi-Fi 6: this band runs an older Wi-Fi mode.{' '}
      <Link {...pageLink('wifi')} className="font-medium link">
        Change it on Networks &amp; radios
      </Link>
      .
    </NotHere>
  );
}

/** The band has no access point of its own for a network setting to go on. */
export function NoNetwork(): ReactElement {
  return (
    <NotHere>
      This band has no network of its own.{' '}
      <a href="/cgi-bin/luci/admin/network/wireless" className="font-medium link">
        Set one up in LuCI
      </a>
      .
    </NotHere>
  );
}

/** The part of a card that shows what's happening now, under its settings, after a hairline. */
export function NowSection({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactElement {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t pt-4">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
