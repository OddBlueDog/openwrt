import { FileUpIcon, HistoryIcon, LoaderCircleIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type ChangeEvent, type ReactElement, useRef, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePoll } from '@/hooks/use-poll';
import { formatBytes } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { deleteRun, getRuns, memberRuns, type RunSummary } from './api';
import { parseExport } from './export';
import { clockText } from './phases';
import { type RunData, type RunReader, useRunData } from './run-data';
import { RunReport } from './run-report';

const when = (epoch: number): string => new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function DeleteButton({ run, onDeleted }: { run: RunSummary; onDeleted: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 text-muted-foreground"
        aria-label="Delete the run"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2Icon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this run?</DialogTitle>
            <DialogDescription>
              {run.plan ?? 'The run'} of {when(run.created_wall)} goes from the router, for every device. A file you downloaded of it stays as it is.
            </DialogDescription>
          </DialogHeader>
          {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                deleteRun(run.id).then(
                  () => {
                    setBusy(false);
                    setOpen(false);
                    onDeleted();
                  },
                  (err: unknown) => {
                    setBusy(false);
                    setError(errorMessage(err));
                  },
                );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The runs the router keeps (the last few, until it restarts), newest
 * first: open one's report again, delete one (the admin), or open a file
 * downloaded earlier. A member sees its own bench's runs.
 */
export function HistoryCard({ reader }: { reader: RunReader }): ReactElement {
  const admin = 'admin' in reader;
  const key = admin ? 'admin' : reader.session;
  const { data: runs, error, refresh } = usePoll(() => (admin ? getRuns() : memberRuns(reader.session)), 15000, key);
  const [openId, setOpenId] = useState<string>();
  const [file, setFile] = useState<{ data: RunData; name: string; exported: string }>();
  const [fileError, setFileError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const { data, error: loadError } = useRunData(reader, openId ?? '', openId !== undefined);

  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f === undefined) return;
    f.text()
      .then((text) => {
        const x = parseExport(text);
        setFile({ data: x.data, name: f.name, exported: x.exported });
        setOpenId(undefined);
        setFileError(undefined);
      })
      .catch((err: unknown) => {
        setFileError(errorMessage(err));
      });
  };

  const list = runs ?? [];
  return (
    <Card>
      <CardHeading
        icon={HistoryIcon}
        title="Past runs"
        description="The router keeps the last few until it restarts: download a run’s report to keep it"
        action={
          <>
            <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
              <FileUpIcon /> Open a file
            </Button>
          </>
        }
      />
      <CardContent className="flex flex-col gap-4">
        {fileError !== undefined && <p className="text-sm text-destructive">Couldn’t open the file: {fileError}</p>}
        {runs === undefined ? (
          error !== undefined ? (
            <p className="text-sm text-destructive">Couldn’t read the runs: {errorMessage(error)}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Reading the runs…
            </p>
          )
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {list.map((r) => {
              const on = r.ended === undefined || r.ended === null;
              const shown = openId === r.id;
              return (
                <li key={r.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2', shown && 'bg-muted/40')}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {r.plan ?? 'Run'}
                      {r.dry === true && <Badge variant="outline">Rehearsal</Badge>}
                      {on && <Badge variant="success">On now</Badge>}
                      {!on && r.ended !== 'completed' && <Badge variant="warning">Ended early</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {when(r.created_wall)}
                      {r.length !== undefined && r.length !== null && ` · ${clockText(r.length)}`} · {r.members.join(', ')} · {formatBytes(r.bytes)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={shown ? 'secondary' : 'outline'}
                      disabled={on}
                      onClick={() => {
                        setOpenId(shown ? undefined : r.id);
                        setFile(undefined);
                      }}
                    >
                      {shown ? 'Close' : 'Open'}
                    </Button>
                    {admin && !on && (
                      <DeleteButton
                        run={r}
                        onDeleted={() => {
                          if (shown) setOpenId(undefined);
                          refresh();
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {openId !== undefined &&
          (data !== undefined ? (
            <RunReport data={data} />
          ) : loadError !== undefined ? (
            <p className="text-sm text-destructive">Couldn’t read the run: {loadError}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Reading the run…
            </p>
          ))}
        {file !== undefined && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{file.data.meta.schedule.name ?? 'Run'}</span>{' '}
                <span className="text-muted-foreground">
                  of {when(file.data.meta.created_wall)}, from {file.name}
                </span>
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Close the file"
                onClick={() => {
                  setFile(undefined);
                }}
              >
                <XIcon />
              </Button>
            </div>
            <RunReport data={file.data} note={`From a file saved ${new Date(file.exported).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}; the checks use this browser’s thresholds.`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
