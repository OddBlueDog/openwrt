// Scheduled tasks on Home: the next one to run, by the router's own clock
// (Home's poll brings it), and how many there are. The tasks are read once.
import type { ReactElement } from 'react';
import { useLoad } from '@/hooks/use-load';
import { getConfig } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { actions, nextRun, sentence, type Task, tasksFrom, whenText } from '../schedules/model';
import type { Dashboard } from './use-dashboard';
import { sharedCall } from '@/lib/shared-call';
import { cn } from '@/lib/utils';
import { EMPTY_GOES } from './fit';
import { OffNote, Widget, WidgetLink } from './widget';

// one call for every Scheduled tasks widget on Home
const loadTasks = sharedCall(async (): Promise<Task[]> => tasksFrom(await getConfig('milkflint')));

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
  const on = tasks.filter((t) => t.enabled);
  const next = nextRun(tasks, d.info.localtime);
  if (next === undefined) {
    return (
      <Widget>
        <OffNote action={<WidgetLink href={href('schedules')}>Add a task</WidgetLink>}>
          Restart the router, or turn Wi-Fi off and on, at set times.
        </OffNote>
      </Widget>
    );
  }
  const others = on.filter((t) => t !== next.task);
  return (
    <Widget status={`${String(on.length)} on`} aside={link}>
      <div className="flex flex-col px-5">
        <span className="text-xs text-muted-foreground">Next</span>
        <span className="text-xl font-semibold tracking-tight">{actions[next.task.action].label}</span>
        <span className="text-sm text-muted-foreground tabular">{whenText(next)}</span>
      </div>
      {others.length > 0 && (
        // the rest, in words, at the widget's foot
        <ul
          className={cn('mt-auto flex flex-col gap-1 border-t px-5 pt-3 text-sm text-muted-foreground', EMPTY_GOES)}
          aria-label="The others"
        >
          {others.slice(0, 2).map((t) => (
            <li key={t.key} data-fit className="truncate" title={sentence(t)}>
              {sentence(t)}
            </li>
          ))}
          {others.length > 2 && <li data-fit>and {String(others.length - 2)} more</li>}
        </ul>
      )}
    </Widget>
  );
}
