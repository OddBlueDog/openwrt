import { CalendarClockIcon, MoonIcon, PlusIcon, PowerIcon, RotateCwIcon, Trash2Icon, WifiIcon, WifiOffIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { bool, type Change, getConfig, list, str } from '@/lib/api/uci';
import { cn } from '@/lib/utils';

const actions = {
  reboot: { label: 'Restart the router', icon: RotateCwIcon },
  wifi_off: { label: 'Turn Wi-Fi off', icon: WifiOffIcon },
  wifi_on: { label: 'Turn Wi-Fi on', icon: WifiIcon },
} as const;
type Action = keyof typeof actions;

// cron numbering: 0 = Sunday
const days = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 0, label: 'Sun' },
] as const;

interface Task {
  /** Stable key in this form. */
  key: string;
  /** UCI section name for tasks already saved. */
  section: string | undefined;
  action: Action;
  time: string;
  /** Empty: every day. */
  days: number[];
  enabled: boolean;
}

let nextKey = 0;
const newKey = (): string => `new-${String(nextKey++)}`;

function isAction(v: string | undefined): v is Action {
  return v !== undefined && v in actions;
}

async function loadTasks(): Promise<Task[]> {
  const sections = await getConfig('milkflint').catch(() => []);
  return sections
    .filter((s) => s['.type'] === 'schedule')
    .flatMap((s): Task[] => {
      const action = str(s, 'action');
      if (!isAction(action)) return [];
      return [
        {
          key: s['.name'],
          section: s['.name'],
          action,
          time: str(s, 'time') ?? '04:00',
          days: list(s, 'days').map(Number).filter((n) => n >= 0 && n <= 6),
          enabled: bool(s, 'enabled', true),
        },
      ];
    });
}

function describeDays(d: readonly number[]): string {
  if (d.length === 0 || d.length === 7) return 'every day';
  const set = new Set(d);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((n) => set.has(n))) return 'weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'weekends';
  return days.filter((x) => set.has(x.n)).map((x) => x.label).join(', ');
}

function toChanges(tasks: readonly Task[], before: readonly Task[]): Change[] {
  const changes: Change[] = [];
  const kept = new Set(tasks.flatMap((t) => (t.section === undefined ? [] : [t.section])));
  for (const old of before) {
    if (old.section !== undefined && !kept.has(old.section)) changes.push({ op: 'delete', config: 'milkflint', section: old.section });
  }
  for (const t of tasks) {
    const values = { action: t.action, time: t.time, enabled: t.enabled ? '1' : '0', ...(t.days.length > 0 && t.days.length < 7 ? { days: t.days.map(String) } : {}) };
    if (t.section === undefined) {
      changes.push({ op: 'add', config: 'milkflint', type: 'schedule', values });
    } else {
      changes.push({ op: 'set', config: 'milkflint', section: t.section, values });
      if (t.days.length === 0 || t.days.length === 7) changes.push({ op: 'unset', config: 'milkflint', section: t.section, options: ['days'] });
    }
  }
  return changes;
}

/** Edits go through `onChange(update)` so several in one render can't overwrite each other. */
function TaskRow({ task, onChange, onDelete }: { task: Task; onChange: (update: (t: Task) => Task) => void; onDelete: () => void }): ReactElement {
  const Icon = actions[task.action].icon;
  const toggleDay = (n: number): void => {
    onChange((t) => {
      const set = new Set(t.days.length === 0 ? days.map((d) => d.n) : t.days);
      if (set.has(n)) set.delete(n);
      else set.add(n);
      return { ...t, days: set.size === 7 ? [] : [...set].sort() };
    });
  };
  const on = (n: number): boolean => task.days.length === 0 || task.days.includes(n);

  return (
    <div className={cn('flex flex-wrap items-center gap-4 rounded-lg border bg-background/60 p-4', !task.enabled && 'opacity-60')}>
      <div className="flex size-9 items-center justify-center rounded-lg bg-secondary">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <Select
        value={task.action}
        onValueChange={(v) => {
          if (isAction(v)) onChange((t) => ({ ...t, action: v }));
        }}
      >
        <SelectTrigger className="w-52" aria-label="Task">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(actions).map(([k, a]) => (
            <SelectItem key={k} value={k}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">at</span>
      <Input
        type="time"
        aria-label="Time"
        className="w-32 font-mono"
        value={task.time}
        onChange={(e) => {
          const time = e.target.value;
          onChange((t) => ({ ...t, time }));
        }}
      />
      <div className="flex gap-1" role="group" aria-label="Days">
        {days.map((d) => (
          <button
            key={d.n}
            type="button"
            aria-pressed={on(d.n)}
            onClick={() => {
              toggleDay(d.n);
            }}
            className={cn(
              'h-8 w-10 rounded-md border text-xs transition-colors',
              on(d.n) ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Switch
          checked={task.enabled}
          onCheckedChange={(v) => {
            onChange((t) => ({ ...t, enabled: v }));
          }}
          aria-label="Task on"
        />
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete task">
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}

export function SchedulesPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadTasks);
  const [edit, setEdit] = useState<Task[]>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const tasks = edit ?? data ?? [];
  const update = (fn: (t: Task[]) => Task[]): void => {
    setEdit((current) => fn(current ?? data ?? []));
  };
  const invalid = tasks.some((t) => !/^\d{2}:\d{2}$/.test(t.time));
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);

  const add = (task: Omit<Task, 'key' | 'section'>): void => {
    update((t) => [...t, { ...task, key: newKey(), section: undefined }]);
  };

  return (
    <>
      <PageHeader title="Scheduled Tasks" description="Restart the router, or turn Wi-Fi off and on, at set times (router time)." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          <Card>
            <CardHeading
              icon={CalendarClockIcon}
              title="Tasks"
              description={tasks.length === 0 ? 'Nothing scheduled.' : tasks.map((t) => `${actions[t.action].label.toLowerCase()} at ${t.time}, ${describeDays(t.days)}`).join('; ')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    add({ action: 'reboot', time: '04:00', days: [], enabled: true });
                  }}
                >
                  <PlusIcon /> Add task
                </Button>
              }
            />
            <CardContent className="flex flex-col gap-3">
              {tasks.map((t) => (
                <TaskRow
                  key={t.key}
                  task={t}
                  onChange={(change) => {
                    update((all) => all.map((x) => (x.key === t.key ? change(x) : x)));
                  }}
                  onDelete={() => {
                    update((all) => all.filter((x) => x.key !== t.key));
                  }}
                />
              ))}
              {tasks.length === 0 && (
                <div className="flex flex-wrap gap-2 rounded-lg border border-dashed p-4">
                  <span className="w-full text-sm text-muted-foreground">Quick start:</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      add({ action: 'reboot', time: '04:00', days: [], enabled: true });
                    }}
                  >
                    <PowerIcon /> Restart every night at 04:00
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      add({ action: 'wifi_off', time: '23:30', days: [], enabled: true });
                      add({ action: 'wifi_on', time: '07:00', days: [], enabled: true });
                    }}
                  >
                    <MoonIcon /> Wi-Fi off overnight (23:30–07:00)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          void apply(toChanges(tasks, data ?? []));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
