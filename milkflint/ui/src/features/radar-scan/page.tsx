// The radar scan is a tab of Nearby networks now (./panel.tsx): its old
// address, #/radar-scan, opens that tab.
import { pageLink } from '@/lib/router';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useEffect } from 'react';
import { FormSkeleton } from '@/components/page-states';

export function RadarScanPage(): ReactElement {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ ...pageLink('wifi-scan', 'radar'), replace: true });
  }, [navigate]);
  return <FormSkeleton />;
}
