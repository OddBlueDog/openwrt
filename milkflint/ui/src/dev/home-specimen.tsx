// Development only (#/specimen): every one of Home's widgets at every size it
// offers, on Home's own grid, with the router's (the VM's) live data, in the
// theme picked at the top of the specimen.
import type { ReactElement } from 'react';
import { HomeGrid } from '@/features/dashboard/home-grid';
import { sizeLabel } from '@/features/dashboard/layout';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import { definition, WIDGET_IDS } from '@/features/dashboard/widgets';
import { useLive } from '@/features/network-quality/live';
import { useRouterMode } from '@/lib/router-mode';

export function HomeSpecimen(): ReactElement {
  const { data } = useDashboard();
  const live = useLive(5000);
  const ap = useRouterMode() === 'ap';
  if (data === undefined) return <p className="text-sm text-muted-foreground">Waiting for the router…</p>;
  const props = { d: data, live, ap };
  return (
    <div className="flex flex-col gap-8">
      {WIDGET_IDS.map((id) => {
        const def = definition(id);
        return (
          <div key={id} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {def.title} <span className="font-normal text-muted-foreground">({id})</span>
            </h3>
            {def.sizes.map((size) => (
              <figure key={sizeLabel(size)} className="flex flex-col gap-1">
                <figcaption className="text-xs text-muted-foreground tabular">{sizeLabel(size)}</figcaption>
                <HomeGrid layout={[{ key: 'specimen', id, size }]} data={props} />
              </figure>
            ))}
          </div>
        );
      })}
    </div>
  );
}
