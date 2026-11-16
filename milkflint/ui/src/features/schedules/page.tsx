// Scheduled tasks: restart the router, or turn Wi-Fi off and on, at set
// times on the router's clock (milkflint.schedule sections; the router's
// cron runs them). The list opens on what's scheduled, in words; each row
// edits in place, and one save applies them all. With nothing scheduled, the
// page says what a task does and offers the two common ones.
import { MoonIcon, PlusIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
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
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';

const actions = {
  reboot: { label: 'Restart the router', done: 'restarts the router' },
  wifi_off: { label: 'Turn Wi-Fi off', done: 'turns Wi-Fi off' },
  wifi_on: { label: 'Turn Wi-Fi on', done: 'turns Wi-Fi on' },
} as const;
type Action = keyof typeof actions;

// cron numbering: 0 = Sunday
const days = [
  { n: 1, label: 'Mon', name: 'Monday' },
  { n: 2, label: 'Tue', name: 'Tuesday' },
  { n: 3, label: 'Wed', name: 'Wednesday' },
  { n: 4, label: 'Thu', name: 'Thursday' },
  { n: 5, label: 'Fri', name: 'Friday' },
  { n: 6, label: 'Sat', name: 'Saturday' },
  { n: 0, label: 'Sun', name: 'Sunday' },
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
          days: list(s, 'days')
            .map(Number)
            .filter((n) => n >= 0 && n <= 6),
          enabled: bool(s, 'enabled', true),
        },
      ];
    });
}

function describeDays(d: readonly number[]): string {
  if (d.length === 0 || d.length === 7) return 'every day';
  const set = new Set(d);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((n) => set.has(n))) return 'on weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'at weekends';
  return `on ${days
    .filter((x) => set.has(x.n))
    .map((x) => x.label)
    .join(', ')}`;
}

/** "Restarts the router at 04:00 every day" */
function sentence(t: Task): string {
  const s = `${actions[t.action].done} at ${t.time} ${describeDays(t.days)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toChanges(tasks: readonly Task[], before: readonly Task[]): Change[] {
  const changes: Change[] = [];
  const kept = new Set(tasks.flatMap((t) => (t.section === undefined ? [] : [t.section])));
  for (const old of before) {
    if (old.section !== undefined && !kept.has(old.section))
      changes.push({ op: 'delete', config: 'milkflint', section: old.section });
  }
  for (const t of tasks) {
    const values = {
      action: t.action,
      time: t.time,
      enabled: t.enabled ? '1' : '0',
      ...(t.days.length > 0 && t.days.length < 7 ? { days: t.days.map(String) } : {}),
    };
    if (t.section === undefined) {
      changes.push({ op: 'add', config: 'milkflint', type: 'schedule', values });
    } else {
      changes.push({ op: 'set', config: 'milkflint', section: t.section, values });
      if (t.days.length === 0 || t.days.length === 7)
        changes.push({ op: 'unset', config: 'milkflint', section: t.section, options: ['days'] });
    }
  }
  return changes;
}

// the columns a task's row lines up in on a wide screen
const columns = 'lg:grid-cols-[15rem_7.5rem_minmax(0,1fr)_6rem_2.25rem]';

/** Edits go through `onChange(update)` so several in one render can't overwrite each other. */
function TaskRow({
  n,
  task,
  onChange,
  onDelete,
}: {
  n: number;
  task: Task;
  onChange: (update: (t: Task) => Task) => void;
  onDelete: () => void;
}): ReactElement {
  const toggleDay = (d: number): void => {
    onChange((t) => {
      const set = new Set(t.days.length === 0 ? days.map((x) => x.n) : t.days);
      if (set.has(d)) set.delete(d);
      else set.add(d);
      return { ...t, days: set.size === 7 ? [] : [...set].sort() };
    });
  };
  const on = (d: number): boolean => task.days.length === 0 || task.days.includes(d);
  const name = `Task ${String(n)}`;

  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-3 py-4', columns)}>
      <Select
        value={task.action}
        onValueChange={(v) => {
          if (isAction(v)) onChange((t) => ({ ...t, action: v }));
        }}
      >
        <SelectTrigger
          className="col-span-3 row-start-1 w-full lg:col-span-1 lg:row-start-auto"
          aria-label={`${name}: what it does`}
        >
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
      <Input
        type="time"
        aria-label={`${name}: time`}
        className="col-start-1 row-start-2 w-32 tabular lg:col-start-auto lg:row-start-auto lg:w-full"
        value={task.time}
        aria-invalid={!/^\d{2}:\d{2}$/.test(task.time)}
        onChange={(e) => {
          const time = e.target.value;
          onChange((t) => ({ ...t, time }));
        }}
      />
      <div
        className="col-span-3 row-start-3 flex flex-wrap gap-1 lg:col-span-1 lg:row-start-auto"
        role="group"
        aria-label={`${name}: days`}
      >
        {days.map((d) => (
          <button
            key={d.n}
            type="button"
            aria-pressed={on(d.n)}
            aria-label={d.name}
            onClick={() => {
              toggleDay(d.n);
            }}
            className={cn(
              'h-8 w-10 cursor-pointer rounded-md border text-xs transition-colors duration-fast',
              on(d.n)
                ? 'border-primary/40 bg-primary-subtle font-medium text-primary-subtle-foreground'
                : 'border-rule text-muted-foreground hover:bg-accent',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <label className="col-start-2 row-start-2 flex items-center gap-2 text-sm lg:col-start-auto lg:row-start-auto">
        <Switch
          checked={task.enabled}
          onCheckedChange={(v) => {
            onChange((t) => ({ ...t, enabled: v }));
          }}
          aria-label={`${name}: on`}
        />
        <span className={task.enabled ? undefined : 'text-muted-foreground'}>{task.enabled ? 'On' : 'Off'}</span>
      </label>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label={`Delete ${name.toLowerCase()}`}
        className="col-start-3 row-start-2 justify-self-end lg:col-start-auto lg:row-start-auto"
      >
        <Trash2Icon />
      </Button>
    </li>
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
  const onTasks = tasks.filter((t) => t.enabled);

  const add = (task: Omit<Task, 'key' | 'section'>): void => {
    update((t) => [...t, { ...task, key: newKey(), section: undefined }]);
  };
  const addButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        add({ action: 'reboot', time: '04:00', days: [], enabled: true });
      }}
    >
      <PlusIcon /> Add task
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Scheduled tasks"
        description="Restart the router, or turn Wi-Fi off and on, at set times on the router’s clock."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : tasks.length === 0 ? (
          <Card>
            <CardHeading
              title="Nothing is scheduled"
              description="A task runs at the same time on the days you pick, by the router’s clock."
            />
            <CardContent className="flex flex-col gap-5">
              <ul className="flex flex-col gap-2 text-sm">
                <li>
                  <span className="font-medium">Restart the router</span>
                  <span className="text-muted-foreground">
                    : the internet and Wi-Fi drop for about a minute, then come back with the same settings.
                  </span>
                </li>
                <li>
                  <span className="font-medium">Turn Wi-Fi off, and on again</span>
                  <span className="text-muted-foreground">
                    : wireless devices lose the network until it’s back on; wired ones keep it.
                  </span>
                </li>
              </ul>
              <div className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-sm font-medium">Start from a common one</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      add({ action: 'reboot', time: '04:00', days: [], enabled: true });
                    }}
                  >
                    <RotateCwIcon /> Restart every night at 04:00
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
                  {addButton}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The router’s time zone is set on{' '}
                <a href={href('time')} className="font-medium link">
                  Name &amp; time
                </a>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeading
              title="Tasks"
              status={onTasks.length === 0 ? 'All turned off: nothing will run.' : `${onTasks.map(sentence).join('. ')}.`}
              action={addButton}
            />
            <CardContent>
              <div
                className={cn('hidden gap-x-4 border-b pb-2 text-xs font-medium text-muted-foreground lg:grid', columns)}
                aria-hidden
              >
                <span>Task</span>
                <span>Time</span>
                <span>Days</span>
                <span>On</span>
                <span />
              </div>
              <ul className="divide-y">
                {tasks.map((t, i) => (
                  <TaskRow
                    key={t.key}
                    n={i + 1}
                    task={t}
                    onChange={(change) => {
                      update((all) => all.map((x) => (x.key === t.key ? change(x) : x)));
                    }}
                    onDelete={() => {
                      update((all) => all.filter((x) => x.key !== t.key));
                    }}
                  />
                ))}
              </ul>
              <p className="border-t pt-4 text-sm text-muted-foreground">
                Times are the router’s clock, in the time zone set on{' '}
                <a href={href('time')} className="font-medium link">
                  Name &amp; time
                </a>
                .
              </p>
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
