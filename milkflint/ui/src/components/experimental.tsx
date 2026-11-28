// The small "Experimental" label beside a setting's control, as the
// Operating Mode page's faster bridging has it.
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';

export function ExperimentalBadge(): ReactElement {
  return (
    <Badge variant="outline" className="shrink-0 font-normal">
      Experimental
    </Badge>
  );
}
