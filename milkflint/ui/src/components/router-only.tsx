import { RadioTowerIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Feature } from '@/features/types';
import { href } from '@/lib/router';

/** In place of a page only the main router needs, in access point mode (an old link or bookmark). */
export function RouterOnly({ feature }: { feature: Feature }): ReactElement {
  return (
    <>
      <PageHeader title={feature.title} description={feature.description} />
      <Alert variant="info">
        <RadioTowerIcon />
        <AlertTitle>Not in access point mode</AlertTitle>
        <AlertDescription>
          <span>
            Your main router does this now, and its own settings page is where to change it. To have MilkFlint do it
            again, switch it back to router mode on the{' '}
            <a href={href('mode')} className="font-medium text-foreground underline underline-offset-2">
              Operating Mode
            </a>{' '}
            page.
          </span>
        </AlertDescription>
      </Alert>
    </>
  );
}
