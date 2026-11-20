// Scheduled tasks on Home: the next one to run, by the router's own clock
// (Home's poll brings it), and how many there are. Root's crontab is read
// once; jobs that run every few minutes are never "next", only counted.
import type { ReactElement } from 'react';
import { useLoad } from '@/hooks/use-load';
import { href } from '@/lib/router';
import { readCrontab } from '../schedules/api';
import { label, nextRun, sentence, type Task, tasksFrom, whenText } from '../schedules/model';
import type { Dashboard } from './use-dashboard';
import { sharedCall } from '@/lib/shared-call';
import { cn } from '@/lib/utils';
import { EMPTY_GOES } from './fit';
import { OffNote, Widget, WidgetLink } from './widget';

// one call for every Scheduled tasks widget on Home
const loadTasks = sharedCall(async (): Promise<Task[]> => tasksFrom(await readCrontab()));

export function ScheduleCard({ d }: { d: Dashboard }): ReactElement {
  const { data: tasks, error } = useLoad(loadTasks);
  const link = <WidgetLink href={href('schedules')}>Scheduled tasks</WidgetLink>;
  if (tasks === undefined) {
    return (
      <Widget aside={error === undefined ? undefined : link}>
        <OffNote action={null}>
          {error === undefined ? 'Reading the scheduled tasks…' : 'The scheduled tasks didn’t load.'}
        </OffNote>
      </Widget>
    );
  }
  const on = tasks.filter((t) => t.job.enabled);
  const next = nextRun(tasks, d.info.localtime);
  if (on.length === 0) {
    return (
      <Widget>
        <OffNote action={<WidgetLink href={href('schedules')}>Add a task</WidgetLink>}>
          Restart the router, turn Wi-Fi off and on, or run your own commands, at set times.
        </OffNote>
      </Widget>
    );
  }
  // only jobs that run every few minutes or hourly: no "next", just what they are
  const others = next === undefined ? on : on.filter((t) => t !== next.task);
  return (
    <Widget status={`${String(on.length)} on`} aside={link}>
      {next !== undefined && (
        <div className="flex flex-col px-5">
          <span className="text-xs text-muted-foreground">Next</span>
          <span className="truncate text-xl font-semibold tracking-tight" title={label(next.task)}>
            {label(next.task)}
          </span>
          <span className="text-sm text-muted-foreground tabular">{whenText(next)}</span>
        </div>
      )}
      {others.length > 0 && (
        // the rest, in words, at the widget's foot
        <ul
          className={cn(
            'mt-auto flex flex-col gap-1 px-5 text-sm text-muted-foreground',
            next !== undefined && 'border-t pt-3',
            EMPTY_GOES,
          )}
          aria-label={next === undefined ? 'Scheduled' : 'The others'}
        >
          {others.slice(0, 2).map((t) => (
            <li key={t.line} data-fit className="truncate" title={sentence(t)}>
              {sentence(t)}
            </li>
          ))}
          {others.length > 2 && <li data-fit>and {String(others.length - 2)} more</li>}
        </ul>
      )}
    </Widget>
  );
}
