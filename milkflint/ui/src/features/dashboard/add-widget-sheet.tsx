// The widget catalogue, opened from "Add widget" while Home is being edited:
// every widget by group, with what it shows and the sizes it comes in. One
// already on Home says so, and can be added again (another Guest Wi-Fi, a
// CPU tile beside its graph); one with nothing to show on this router says
// that instead. No live previews: each would poll the router.
import { PlusIcon } from 'lucide-react';
import { type ReactElement, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useDecorativeIcons } from '@/lib/presentation';
import { type Layout, MAX_WIDGETS, sizeLabel } from './layout';
import { definition, GROUPS, type HomeData, WIDGET_IDS, type WidgetId } from './widgets';

export function AddWidgetSheet({
  open,
  onOpenChange,
  layout,
  data,
  onAdd,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: Layout<WidgetId>;
  data: HomeData;
  onAdd: (id: WidgetId) => void;
  /** Where focus goes once it's closed: the widget just added, rather than the button that opened it. */
  onCloseAutoFocus: (e: Event) => void;
}): ReactElement {
  const icons = useDecorativeIcons();
  const heading = useId();
  const placed = new Map<WidgetId, number>();
  for (const w of layout) placed.set(w.id, (placed.get(w.id) ?? 0) + 1);
  const full = layout.length >= MAX_WIDGETS;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent onCloseAutoFocus={onCloseAutoFocus}>
        <div className="flex flex-col gap-1 border-b px-5 py-4 pr-12">
          <SheetTitle>Add a widget</SheetTitle>
          <SheetDescription>
            {full
              ? `Home holds ${String(MAX_WIDGETS)} widgets at most: remove one to add another.`
              : 'It goes at the end of Home; drag it, or use its arrows, to move it.'}
          </SheetDescription>
        </div>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
          {GROUPS.map((group, g) => {
            const ids = WIDGET_IDS.filter((id) => definition(id).group === group);
            if (ids.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`${heading}-${String(g)}`} className="flex flex-col gap-2">
                <h3 id={`${heading}-${String(g)}`} className="text-sm font-semibold">
                  {group}
                </h3>
                <ul className="flex flex-col divide-y rounded-lg border">
                  {ids.map((id) => {
                    const { title, description, icon: Icon, sizes, hidden } = definition(id);
                    const on = placed.get(id) ?? 0;
                    const nothing = hidden?.(data) === true;
                    return (
                      <li key={id} className="flex items-start gap-3 px-4 py-3">
                        {icons && <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm font-medium">{title}</span>
                          <span className="text-sm text-muted-foreground">{description}</span>
                          <span className="text-xs text-muted-foreground tabular">
                            {sizes.length === 1 ? 'Size' : 'Sizes'} {sizes.map(sizeLabel).join(', ')}
                            {on > 0 && ` · ${on === 1 ? 'on Home' : `${String(on)} on Home`}`}
                          </span>
                        </div>
                        <div className="flex min-h-8 shrink-0 items-center">
                          {nothing ? (
                            <span className="max-w-32 text-right text-xs text-muted-foreground">
                              Nothing to show on this router
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={on > 0 ? `Add another ${title}` : `Add ${title}`}
                              disabled={full}
                              onClick={() => {
                                onAdd(id);
                              }}
                            >
                              <PlusIcon /> Add
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
