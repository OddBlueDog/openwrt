// "Updated 12 s ago · next in 18 s", from what useLive returns. Ticks once a second.
import { useEffect, useState, type ReactElement } from 'react';
import { freshnessText } from '@/lib/freshness';

export function Freshness({ at, next }: { at?: number | undefined; next?: number | undefined }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return <span>{freshnessText(Math.max(now, at ?? 0), at, next)}</span>;
}
