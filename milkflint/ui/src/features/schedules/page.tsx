// Scheduled tasks: what root's crontab runs, by the router's clock. The
// router's own cron runs it, and LuCI's Scheduled Tasks edits the same file.
// Two views of one draft of it: Tasks, each job in words (restart the
// router, Wi-Fi off or on, banIP's update, your own commands), with the
// common ones' time and days edited in place; and Crontab, the file as text,
// a line numbered and checked as cron reads it. An edit in either shows in
// the other; one save writes the file, if nothing else changed it meanwhile.
import { MoonIcon, PlusIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ApplyState } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { href } from '@/lib/router';
import { cn, errorMessage } from '@/lib/utils';
import { CRONTAB, readCrontab, saveCrontab } from './api';
import { crontabText, parseCrontab } from './cron';
import {
  type Action,
  actions,
  addTask,
  days,
  editTask,
  isAction,
  label,
  removeLine,
  sentence,
  type Task,
  type TaskChange,
  tasksOf,
  whenOf,
} from './model';

type View = 'tasks' | 'crontab';

const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// the columns a task's row lines up in on a wide screen
const columns = 'lg:grid-cols-[15rem_7.5rem_minmax(0,1fr)_6rem_2.25rem]';

/** A time typed in: kept here while it's half typed, passed on once it's a time. */
function TimeInput({
  value,
  label: name,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (time: string) => void;
}): ReactElement {
  const [typed, setTyped] = useState(value);
  // a new time from outside (a task moved up a line when one above it went): shown instead
  const [given, setGiven] = useState(value);
  if (value !== given) {
    setGiven(value);
    setTyped(value);
  }
  const valid = /^\d{2}:\d{2}$/.test(typed);
  return (
    <Input
      type="time"
      aria-label={name}
      className="col-start-1 row-start-2 w-32 tabular lg:col-start-auto lg:row-start-auto lg:w-full"
      value={typed}
      aria-invalid={!valid}
      onChange={(e) => {
        setTyped(e.target.value);
        if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value);
      }}
    />
  );
}

function DayButtons({ task, name, onChange }: { task: Task; name: string; onChange: (d: number[]) => void }): ReactElement {
  const chosen = task.simple?.days ?? [];
  const on = (d: number): boolean => chosen.length === 0 || chosen.includes(d);
  const toggle = (d: number): void => {
    const set = new Set(chosen.length === 0 ? days.map((x) => x.n) : chosen);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    // none left: every day, as cron reads "*"
    onChange(set.size === 7 ? [] : [...set].sort());
  };
  return (
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
            toggle(d.n);
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
  );
}

function TaskRow({
  n,
  task,
  onChange,
  onDelete,
  onCrontab,
}: {
  n: number;
  task: Task;
  onChange: (change: TaskChange) => void;
  onDelete: () => void;
  onCrontab: () => void;
}): ReactElement {
  const name = `Task ${String(n)}`;
  const banip = task.kind === 'banip';
  const what: ReactNode = isAction(task.kind) ? (
    <Select
      value={task.kind}
      onValueChange={(v) => {
        if (isAction(v)) onChange({ action: v });
      }}
    >
      <SelectTrigger className="w-full" aria-label={`${name}: what it does`}>
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
  ) : banip ? (
    <span className="text-sm font-medium">{label(task)}</span>
  ) : (
    <span className="flex min-w-0 flex-col">
      <span className="text-xs text-muted-foreground">Runs</span>
      <code className="truncate font-mono text-xs" title={task.job.command}>
        {task.job.command}
      </code>
    </span>
  );

  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-3 py-4', columns)}>
      <div className="col-span-3 row-start-1 min-w-0 lg:col-span-1 lg:row-start-auto">{what}</div>
      {task.simple !== undefined && !banip ? (
        <>
          <TimeInput
            value={task.simple.time}
            label={`${name}: time`}
            onChange={(time) => {
              onChange({ time });
            }}
          />
          <DayButtons
            task={task}
            name={name}
            onChange={(d) => {
              onChange({ days: d });
            }}
          />
        </>
      ) : (
        // times the view doesn't edit: in words, and where they're changed
        <p className="col-span-3 row-start-3 text-sm lg:col-span-2 lg:row-start-auto">
          {capitalised(whenOf(task))}
          <span className="block text-xs text-muted-foreground">
            {banip ? (
              <>
                Set on the{' '}
                <a href={href('banip')} className="font-medium link">
                  banIP page
                </a>
              </>
            ) : (
              <>
                Change these times in the{' '}
                <button type="button" className="cursor-pointer font-medium link" onClick={onCrontab}>
                  crontab
                </button>
              </>
            )}
          </span>
        </p>
      )}
      {banip ? (
        <span className="col-start-2 row-start-2 text-sm text-muted-foreground lg:col-start-auto lg:row-start-auto">
          {task.job.enabled ? 'On' : 'Off'}
        </span>
      ) : (
        <label className="col-start-2 row-start-2 flex items-center gap-2 text-sm lg:col-start-auto lg:row-start-auto">
          <Switch
            checked={task.job.enabled}
            onCheckedChange={(v) => {
              onChange({ enabled: v });
            }}
            aria-label={`${name}: on`}
          />
          <span className={task.job.enabled ? undefined : 'text-muted-foreground'}>{task.job.enabled ? 'On' : 'Off'}</span>
        </label>
      )}
      {banip ? (
        <span className="col-start-3 row-start-2 lg:col-start-auto lg:row-start-auto" />
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label={`Delete ${name.toLowerCase()}`}
          className="col-start-3 row-start-2 justify-self-end lg:col-start-auto lg:row-start-auto"
        >
          <Trash2Icon />
        </Button>
      )}
    </li>
  );
}

const timeZoneNote = (
  <>
    Times are the router’s clock, in the time zone set on{' '}
    <a href={href('time')} className="font-medium link">
      Name &amp; time
    </a>
    .
  </>
);

function TasksView({
  text,
  setText,
  onCrontab,
}: {
  text: string;
  setText: (fn: (text: string) => string) => void;
  onCrontab: () => void;
}): ReactElement {
  const tasks = tasksOf(parseCrontab(text));
  const on = tasks.filter((t) => t.job.enabled);
  const add = (action: Action, time: string): void => {
    setText((t) => addTask(t, action, time));
  };
  const addButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        add('reboot', '04:00');
      }}
    >
      <PlusIcon /> Add task
    </Button>
  );

  if (tasks.length === 0) {
    return (
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
                  add('reboot', '04:00');
                }}
              >
                <RotateCwIcon /> Restart every night at 04:00
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setText((t) => addTask(addTask(t, 'wifi_off', '23:30'), 'wifi_on', '07:00'));
                }}
              >
                <MoonIcon /> Wi-Fi off overnight (23:30–07:00)
              </Button>
              {addButton}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Your own commands go in the{' '}
            <button type="button" className="cursor-pointer font-medium link" onClick={onCrontab}>
              crontab
            </button>
            . {timeZoneNote}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeading
        title="Tasks"
        status={
          on.length === 0
            ? 'All turned off: nothing will run.'
            : on.length <= 3
              ? `${on.map(sentence).join('. ')}.`
              : `${String(on.length)} of ${String(tasks.length)} turned on.`
        }
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
              // its line: the row stays put while its own line is rewritten
              key={t.line}
              n={i + 1}
              task={t}
              onChange={(change) => {
                setText((x) => editTask(x, t.line, change));
              }}
              onDelete={() => {
                setText((x) => removeLine(x, t.line));
              }}
              onCrontab={onCrontab}
            />
          ))}
        </ul>
        <p className="border-t pt-4 text-sm text-muted-foreground">
          {timeZoneNote} Your own commands go in the{' '}
          <button type="button" className="cursor-pointer font-medium link" onClick={onCrontab}>
            crontab
          </button>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function CrontabView({ text, setText, before }: { text: string; setText: (text: string) => void; before: string }): ReactElement {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => parseCrontab(text), [text]);
  const old = useMemo(() => new Set(parseCrontab(before).flatMap((l) => (l.error === undefined ? [] : [l.text]))), [before]);
  const problems = lines.flatMap((l, i) => (l.error === undefined ? [] : [{ n: i + 1, error: l.error, old: old.has(l.text) }]));
  const rows = Math.max(lines.length, 1);
  return (
    <Card>
      <CardHeading
        title="Crontab"
        description={
          <>
            <code className="font-mono text-xs">{CRONTAB}</code>, as cron reads it: a line per job, its minute, hour, day of the
            month, month and day of the week (<code className="font-mono text-xs">*</code> for any), then the command. A line
            starting with <code className="font-mono text-xs">#</code> is a note, or a job switched off.
          </>
        }
      />
      <CardContent className="flex flex-col gap-3">
        <div className="flex h-80 overflow-hidden rounded-md border bg-card focus-within:ring-2 focus-within:ring-ring">
          <div
            ref={gutter}
            aria-hidden="true"
            className="w-10 shrink-0 overflow-hidden border-r bg-muted/40 py-2 text-right font-mono text-xs leading-5"
          >
            {Array.from({ length: rows }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'pr-2',
                  lines[i]?.error === undefined ? 'text-muted-foreground' : 'bg-destructive/15 text-destructive',
                )}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            aria-label="The crontab, a job a line"
            value={text}
            spellCheck={false}
            wrap="off"
            className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
            placeholder="0 4 * * * /sbin/reboot"
            onScroll={(e) => {
              if (gutter.current !== null) gutter.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </div>
        {problems.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs" aria-label="Lines cron won’t read">
            {problems.slice(0, 6).map((p) => (
              <li key={p.n} className={p.old ? 'text-muted-foreground' : 'text-destructive'}>
                Line {p.n}: {p.error}
                {p.old && ' (it was there already: cron skips it)'}
              </li>
            ))}
            {problems.length > 6 && <li className="text-muted-foreground">and {problems.length - 6} more</li>}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          {lines.some((l) => l.text.startsWith('# milkflint-banip begin')) && (
            <>
              banIP’s update, between its <code className="font-mono text-xs"># milkflint-banip</code> lines, is set on the{' '}
              <a href={href('banip')} className="font-medium link">
                banIP page
              </a>
              : a change to it here comes back.{' '}
            </>
          )}
          {timeZoneNote}
        </p>
      </CardContent>
    </Card>
  );
}

export function SchedulesPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(readCrontab);
  // the file as saved last (by this page, or as it was read), and the edit in progress
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [view, setView] = useState<View>('tasks');
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  const before = saved ?? data ?? '';
  const text = draft ?? before;
  const dirty = draft !== undefined && draft !== before;
  // a line cron won't read blocks the save, unless it was there already
  const old = new Set(parseCrontab(before).flatMap((l) => (l.error === undefined ? [] : [l.text])));
  const invalid = parseCrontab(text).some((l) => l.error !== undefined && !old.has(l.text));

  const save = async (): Promise<void> => {
    setState({ phase: 'applying' });
    // each line ended by a newline, the last too (cron may skip a last line without one)
    const file = crontabText(parseCrontab(text).map((l) => l.text));
    try {
      await saveCrontab(file, before);
      setSaved(file);
      setDraft(undefined);
      setState({ phase: 'done', nothingChanged: false });
    } catch (err) {
      setState({ phase: 'failed', message: errorMessage(err) });
    }
  };

  return (
    <>
      <PageHeader
        title="Scheduled tasks"
        description="Restart the router, turn Wi-Fi off and on, or run your own commands, at set times on the router’s clock. They’re root’s crontab, which LuCI’s Scheduled Tasks edits too."
        actions={
          data !== undefined && (
            <Segmented<View>
              label="Show"
              value={view}
              options={[
                { value: 'tasks', label: 'Tasks' },
                { value: 'crontab', label: 'Crontab' },
              ]}
              onChange={setView}
            />
          )
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : view === 'tasks' ? (
          <TasksView
            text={text}
            setText={(fn) => {
              setDraft((d) => fn(d ?? before));
            }}
            onCrontab={() => {
              setView('crontab');
            }}
          />
        ) : (
          <CrontabView text={text} setText={setDraft} before={before} />
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          void save();
        }}
        onRevert={() => {
          setDraft(undefined);
        }}
      />
    </>
  );
}
