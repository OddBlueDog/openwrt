// The Themes page's list: every theme as a card with a picture of it in
// light and dark, the one in use marked; built-in themes first, then your
// own. More themes only add cards: the grid takes as many as come.
import { CopyIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Theme } from '@/theme/contract';
import { ThemeThumbnail } from './preview';

export interface CardActions {
  onUse: () => void;
  /** #/themes/new/<id>: a new custom theme from this one */
  customise: string;
  /** a custom theme's own page */
  edit?: string;
  onDelete?: () => void;
}

function ThemeCard({
  theme,
  inUse,
  busy,
  custom,
  actions,
}: {
  theme: Theme;
  inUse: boolean;
  busy: boolean;
  custom: boolean;
  actions: CardActions;
}): ReactElement {
  const [asking, setAsking] = useState(false);
  const titleId = `theme-${theme.id}-name`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
    >
      {/* light and dark side by side: each device picks its own */}
      <div className="grid grid-cols-2 gap-px border-b bg-border">
        <ThemeThumbnail themeId={theme.id} dark={false} label={`${theme.name}, light`} />
        <ThemeThumbnail themeId={theme.id} dark label={`${theme.name}, dark`} />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={titleId} className="font-semibold">
            {theme.name}
          </h3>
          {inUse && <Badge variant="success">In use</Badge>}
        </div>
        {theme.description !== undefined && <p className="text-sm text-muted-foreground">{theme.description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        {!inUse && (
          <Button size="sm" onClick={actions.onUse} disabled={busy}>
            Use this theme
          </Button>
        )}
        {custom && actions.edit !== undefined ? (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={actions.edit}>
                <PencilIcon />
                Edit
              </a>
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={actions.customise} aria-label={`Copy ${theme.name}`} title="Copy">
                <CopyIcon />
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              aria-label={`Delete ${theme.name}`}
              title="Delete"
              disabled={busy}
              onClick={() => {
                setAsking(true);
              }}
            >
              <Trash2Icon />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <a href={actions.customise}>Customise</a>
          </Button>
        )}
      </div>
      {actions.onDelete !== undefined && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {theme.name}?</DialogTitle>
              <DialogDescription>
                {inUse ? 'It’s in use, so the default theme takes over. This can’t be undone.' : 'This can’t be undone.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setAsking(false);
                }}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setAsking(false);
                  actions.onDelete?.();
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

export function ThemeGrid({
  themes,
  current,
  busy,
  custom,
  actionsFor,
}: {
  themes: readonly Theme[];
  current: string;
  busy: boolean;
  custom: boolean;
  actionsFor: (theme: Theme) => CardActions;
}): ReactElement {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {themes.map((t) => (
        <ThemeCard key={t.id} theme={t} inUse={t.id === current} busy={busy} custom={custom} actions={actionsFor(t)} />
      ))}
    </ul>
  );
}
