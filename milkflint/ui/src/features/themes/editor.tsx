// Changing a theme's colours: a few main colours (each bringing the ones that
// go with it) or every colour one at a time, for light and dark, with the
// draft drawn beside it and checked against WCAG 2.2 AA as you go. Saved on
// the router as a custom theme (src/theme/custom.ts); a new one is put in use.
import { Link, useNavigate } from '@tanstack/react-router';
import { pageLink } from '@/lib/router';
import { ArrowLeftIcon, CheckCircle2Icon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { SaveArea } from '@/components/save-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { ApplyState } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { previewTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { type ContrastFailure, contrastFailures } from '@/theme/checks';
import { toHex } from '@/theme/color';
import type { ColorToken, Theme } from '@/theme/contract';
import {
  type ColorChanges,
  colorsOf,
  type MainColor,
  MAIN_COLORS,
  NAME_MAX,
  newCustomId,
  pickMain,
  pickOne,
  resolveCustom,
  type SchemeName,
  STATUS_COLORS,
  TOKEN_GROUPS,
  TOKEN_LABELS,
} from '@/theme/custom';
import { themes as builtIn } from '@/theme/themes';
import { themeFormSchema } from './model';
import { ThemeSample } from './preview';
import { useSaveTheme } from './queries';

/** The draft's id while it's drawn beside the editor (never saved under it). */
const DRAFT_ID = 'custom-draft';
const HEX = /^#?([0-9a-f]{6})$/i;

export interface EditorSource {
  /** set when changing a saved custom theme; a new one gets its id on saving */
  id?: string;
  name: string;
  base: Theme;
  colors: Record<SchemeName, ColorChanges>;
}

function ColorRow({
  id,
  label,
  hint,
  value,
  changed,
  onPick,
  onReset,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  changed: boolean;
  onPick: (hex: string) => void;
  onReset: () => void;
}): ReactElement {
  const [text, setText] = useState(value);
  // a pick elsewhere (a main colour, put back) shows here at once
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  const commit = (v: string): void => {
    const m = HEX.exec(v.trim());
    if (m?.[1] !== undefined) onPick(`#${m[1].toLowerCase()}`);
    else setText(value);
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {changed && <span className="ml-2 text-xs font-normal text-muted-foreground">changed</span>}
        </label>
        {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          aria-label={`${label}: pick a colour`}
          onChange={(e) => {
            onPick(e.target.value);
          }}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5"
        />
        <Input
          id={id}
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label}: hex value`}
          onChange={(e) => {
            setText(e.target.value);
            if (HEX.test(e.target.value.trim())) commit(e.target.value);
          }}
          onBlur={(e) => {
            commit(e.target.value);
          }}
          className="h-9 w-[5.75rem] font-mono text-xs"
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Put ${label} back`}
          title="Put back"
          disabled={!changed}
          onClick={onReset}
          className={cn('size-8', !changed && 'invisible')}
        >
          <RotateCcwIcon />
        </Button>
      </div>
    </li>
  );
}

function Contrast({
  failures,
  onShow,
}: {
  failures: Record<SchemeName, ContrastFailure[]>;
  onShow: (scheme: SchemeName, token: ColorToken) => void;
}): ReactElement {
  const total = failures.light.length + failures.dark.length;
  return (
    <section aria-labelledby="theme-contrast" className="flex flex-col gap-2">
      <h3 id="theme-contrast" className="text-sm font-semibold">
        Contrast
      </h3>
      {total === 0 ? (
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          Every pair meets WCAG 2.2 AA, in light and in dark.
        </p>
      ) : (
        <>
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              {total} {total === 1 ? 'pair is' : 'pairs are'} below WCAG 2.2 AA: text needs 4.5:1, form borders, focus rings and
              chart lines 3:1.
            </span>
          </p>
          <ul className="flex flex-col divide-y text-sm">
            {(['light', 'dark'] as const).flatMap((s) =>
              failures[s].map((f) => (
                <li key={`${s}-${f.fg}-${f.bg}`} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    {TOKEN_LABELS[f.fg]} on {TOKEN_LABELS[f.bg].toLowerCase()}
                    <span className="block text-xs text-muted-foreground tabular">
                      {s === 'light' ? 'Light' : 'Dark'}: {f.ratio.toFixed(1)}:1, needs {f.min}:1
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => {
                      onShow(s, f.fg);
                    }}
                  >
                    Change
                  </Button>
                </li>
              )),
            )}
          </ul>
        </>
      )}
    </section>
  );
}

export function ThemeEditor({
  source,
  takenIds,
  onStatus,
}: {
  source: EditorSource;
  /** custom ids in use, so a new one doesn't take one */
  takenIds: readonly string[];
  onStatus: (state: ApplyState) => void;
}): ReactElement {
  const navigate = useNavigate();
  const editing = source.id !== undefined;
  const { dark } = useTheme();
  // the draft: what it's called and the colours changed from its base
  const [saved] = useState(() => ({ name: source.name, colors: source.colors }));
  const saveTheme = useSaveTheme();
  const settings = useSettingsForm({
    schema: themeFormSchema,
    saved,
    onSave: (values) => save(values.name.trim(), values.colors),
  });
  const { form } = settings;
  const { name, colors: changes } = useFormValues(form);
  const setName = (value: string): void => {
    form.setFieldValue('name', value);
  };
  const setChanges = (next: (c: Record<SchemeName, ColorChanges>) => Record<SchemeName, ColorChanges>): void => {
    form.setFieldValue('colors', next);
  };
  const [scheme, setScheme] = useState<SchemeName>(dark ? 'dark' : 'light');
  const [tab, setTab] = useState<'main' | 'all'>('main');
  const busy = saveTheme.isPending;
  const base = source.base;

  const draft = useMemo(
    () => resolveCustom({ id: DRAFT_ID, name: name === '' ? base.name : name, base: base.id, colors: changes }, builtIn),
    [name, base, changes],
  );
  useEffect(() => {
    previewTheme(draft);
  }, [draft]);
  useEffect(
    () => () => {
      previewTheme(undefined);
    },
    [],
  );

  const colors = colorsOf(base, scheme, changes[scheme]);
  const hex = (token: ColorToken): string => toHex(colors[token]);
  const failures = useMemo(
    () => ({
      light: contrastFailures(colorsOf(base, 'light', changes.light)),
      dark: contrastFailures(colorsOf(base, 'dark', changes.dark)),
    }),
    [base, changes],
  );
  const total = failures.light.length + failures.dark.length;
  const trimmed = name.trim();
  const nameError = trimmed === '' ? 'Give it a name.' : undefined;
  const dirty = !editing || settings.dirty;

  const setScheme1 = (next: ColorChanges): void => {
    setChanges((c) => ({ ...c, [scheme]: next }));
  };
  const pickMainColor = (m: MainColor, value: string): void => {
    setChanges((c) => ({ ...c, [scheme]: pickMain(m, value, scheme, base, c[scheme]) }));
  };
  const resetMain = (m: MainColor): void => {
    const touched = new Set(Object.keys(m.derive(hex(m.token), scheme, colors)));
    setScheme1(Object.fromEntries(Object.entries(changes[scheme]).filter(([t]) => !touched.has(t))));
  };
  const show = (s: SchemeName, token: ColorToken): void => {
    setScheme(s);
    setTab('all');
    window.setTimeout(() => {
      document.getElementById(`theme-color-${token}`)?.focus();
    }, 0);
  };

  async function save(named: string, colors: Record<SchemeName, ColorChanges>): Promise<void> {
    onStatus({ phase: 'applying' });
    try {
      if (source.id !== undefined) {
        await saveTheme.mutateAsync({ theme: { id: source.id, name: named, base: base.id, colors }, use: false });
        onStatus({ phase: 'done', nothingChanged: false, note: `${named} is saved.` });
      } else {
        await saveTheme.mutateAsync({
          theme: { id: newCustomId(named, takenIds), name: named, base: base.id, colors },
          use: true,
        });
        onStatus({ phase: 'done', nothingChanged: false, note: `${named} is saved and in use.` });
      }
      void navigate(pageLink('themes'));
    } catch (e) {
      onStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const mainRows = (list: readonly MainColor[]): ReactElement => (
    <ul className="flex flex-col divide-y">
      {list.map((m) => (
        <ColorRow
          key={m.token}
          id={`theme-main-${m.token}`}
          label={m.label}
          hint={m.hint}
          value={hex(m.token)}
          changed={m.token in changes[scheme]}
          onPick={(v) => {
            pickMainColor(m, v);
          }}
          onReset={() => {
            resetMain(m);
          }}
        />
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${source.name}` : `Customise ${base.name}`}
        description="Change its colours for light and dark; the preview shows them as you go."
        actions={
          <Button variant="outline" asChild>
            <Link {...pageLink('themes')}>
              <ArrowLeftIcon />
              All themes
            </Link>
          </Button>
        }
      />
      {/* wide: the name and colours on the left, the preview kept in view on the right; narrow: name, preview, colours */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,26rem)]">
        <Card className="lg:col-start-1">
          <CardContent>
            <Field
              id="theme-name"
              label="Name"
              className="py-0"
              hint={`From ${base.name}. Light or dark stays each device’s own choice.`}
              error={nameError}
            >
              <Input
                id="theme-name"
                value={name}
                maxLength={NAME_MAX}
                aria-invalid={nameError !== undefined}
                aria-describedby={nameError === undefined ? undefined : 'theme-name-error'}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </Field>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <CardTitle>{scheme === 'light' ? 'Preview, light' : 'Preview, dark'}</CardTitle>
              <ThemeSample
                themeId={DRAFT_ID}
                dark={scheme === 'dark'}
                label={`${trimmed === '' ? base.name : trimmed}, ${scheme}`}
              />
              <Contrast failures={failures} onShow={show} />
            </CardContent>
          </Card>
        </div>
        <Card className="lg:col-start-1">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{scheme === 'light' ? 'Light colours' : 'Dark colours'}</CardTitle>
              <Segmented
                label="Colours changed"
                value={scheme}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                onChange={setScheme}
              />
            </div>
            <Tabs
              label="Which colours"
              prefix="theme-colors"
              items={[
                { id: 'main', label: 'Main colours' },
                { id: 'all', label: 'Every colour' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <TabPanel prefix="theme-colors" id="main" value={tab} className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Each also sets the colours that go with it: a new accent brings its hover, tints and focus rings.
              </p>
              {mainRows(MAIN_COLORS)}
              <h3 className="pt-2 text-sm font-semibold">States</h3>
              {mainRows(STATUS_COLORS)}
            </TabPanel>
            <TabPanel prefix="theme-colors" id="all" value={tab} className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">One colour at a time, nothing else moves with it.</p>
              {TOKEN_GROUPS.map((g) => (
                <section key={g.title} aria-label={g.title} className="flex flex-col">
                  <h3 className="text-sm font-semibold">{g.title}</h3>
                  <ul className="flex flex-col divide-y">
                    {g.tokens.map((token) => (
                      <ColorRow
                        key={token}
                        id={`theme-color-${token}`}
                        label={TOKEN_LABELS[token]}
                        value={hex(token)}
                        changed={token in changes[scheme]}
                        onPick={(v) => {
                          setChanges((c) => ({ ...c, [scheme]: pickOne(token, v, scheme, base, c[scheme]) }));
                        }}
                        onReset={() => {
                          setScheme1(Object.fromEntries(Object.entries(changes[scheme]).filter(([t]) => t !== token)));
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </TabPanel>
          </CardContent>
        </Card>
      </div>
      <SaveArea
        visible={dirty}
        busy={busy}
        invalid={nameError !== undefined}
        warnings={
          total === 0
            ? []
            : [
                `${String(total)} colour ${total === 1 ? 'pair is' : 'pairs are'} below WCAG 2.2 AA (see Contrast). It saves anyway.`,
              ]
        }
        warningTitle="Some text or lines are hard to see"
        confirm={undefined}
        onSave={settings.save}
        onRevert={() => {
          if (editing) settings.discard();
          else void navigate(pageLink('themes'));
        }}
      />
    </>
  );
}
