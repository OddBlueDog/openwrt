// Themes: how the interface looks. The theme in use is the router's, so every
// device that opens the interface shows it; light or dark is each device's
// own. Built-in themes can be customised into your own, kept on the router.
// #/themes lists them; #/themes/new/<id> customises one (a built-in, or a
// copy of your own); #/themes/edit/<id> changes one of yours.
import { TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { Segmented } from '@/components/ui/segmented';
import type { ApplyState } from '@/hooks/use-apply';
import { useSubPath } from '@/lib/router';
import { deleteCustomTheme, type SchemeChoice, setTheme, setThemeId, useTheme, useThemes } from '@/lib/theme';
import type { Theme } from '@/theme/contract';
import { baseOf } from '@/theme/custom';
import { themes as builtIn } from '@/theme/themes';
import { type EditorSource, ThemeEditor } from './editor';
import { ThemeGrid } from './gallery';

/** What #/themes/new/<id> or #/themes/edit/<id> opens, if that theme exists. */
function sourceFor(path: string, view: ReturnType<typeof useThemes>): EditorSource | undefined {
  const [action, id] = path.split('/');
  const mine = view.custom.find((c) => c.saved.id === id)?.saved;
  if (action === 'edit' && mine !== undefined)
    return { id: mine.id, name: mine.name, base: baseOf(mine, builtIn), colors: mine.colors };
  if (action !== 'new') return undefined;
  if (mine !== undefined)
    return { name: `${mine.name} copy`.slice(0, 40), base: baseOf(mine, builtIn), colors: structuredClone(mine.colors) };
  const theme = view.builtIn.find((t) => t.id === id);
  return theme === undefined
    ? undefined
    : { name: `My ${theme.name}`.slice(0, 40), base: theme, colors: { light: {}, dark: {} } };
}

function SchemePicker(): ReactElement {
  const { choice } = useTheme();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground" id="themes-scheme-label">
        On this device
      </span>
      <Segmented<SchemeChoice>
        label="Light or dark on this device"
        value={choice}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'system', label: 'Match device' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={setTheme}
      />
    </div>
  );
}

export function ThemesPage(): ReactElement {
  const path = useSubPath();
  const view = useThemes();
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  const busy = state.phase === 'applying';
  const source = path === '' ? undefined : sourceFor(path, view);

  const run = async (work: () => Promise<void>, note: string): Promise<void> => {
    setState({ phase: 'applying' });
    try {
      await work();
      setState({ phase: 'done', nothingChanged: false, note });
    } catch (e) {
      setState({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };
  const pick = (theme: Theme): void => {
    void run(() => setThemeId(theme.id), `${theme.name} is in use.`);
  };

  if (source !== undefined) {
    return (
      <>
        <ThemeEditor
          // a new path is a new draft
          key={path}
          source={source}
          takenIds={view.custom.map((c) => c.saved.id)}
          onStatus={setState}
        />
        <ApplyStatus state={state} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Themes"
        description="How the interface looks on every device that opens it. Light or dark is each device’s own choice."
        actions={<SchemePicker />}
      />
      <div className="flex flex-col gap-8">
        {path !== '' && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            That theme isn’t on this router any more, so here are the ones that are.
          </Note>
        )}
        <section aria-labelledby="themes-built-in" className="flex flex-col gap-3">
          <h2 id="themes-built-in" className="text-base font-semibold">
            Built in
          </h2>
          <ThemeGrid
            themes={view.builtIn}
            current={view.current}
            busy={busy}
            custom={false}
            actionsFor={(t) => ({
              onUse: () => {
                pick(t);
              },
              customise: `#/themes/new/${t.id}`,
            })}
          />
        </section>
        <section aria-labelledby="themes-yours" className="flex flex-col gap-3">
          <h2 id="themes-yours" className="text-base font-semibold">
            Your themes
          </h2>
          {view.custom.length === 0 ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              None yet. Customise a theme above to change its colours and keep it as your own.
            </p>
          ) : (
            <ThemeGrid
              themes={view.custom.map((c) => c.theme)}
              current={view.current}
              busy={busy}
              custom
              actionsFor={(t) => ({
                onUse: () => {
                  pick(t);
                },
                customise: `#/themes/new/${t.id}`,
                edit: `#/themes/edit/${t.id}`,
                onDelete: () => {
                  void run(() => deleteCustomTheme(t.id), `${t.name} is gone from the router.`);
                },
              })}
            />
          )}
        </section>
      </div>
      <ApplyStatus state={state} />
    </>
  );
}
