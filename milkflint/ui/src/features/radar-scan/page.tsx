// The radar scan is a tab of Nearby networks now (./panel.tsx): its old
// address, #/radar-scan, opens that tab.
import { type ReactElement, useEffect } from 'react';
import { FormSkeleton } from '@/components/page-states';
import { href } from '@/lib/router';

export function RadarScanPage(): ReactElement {
  useEffect(() => {
    window.location.replace(`${href('wifi-scan')}/radar`);
  }, []);
  return <FormSkeleton />;
}
