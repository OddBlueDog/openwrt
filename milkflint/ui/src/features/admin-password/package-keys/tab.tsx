// The Package keys tab: the keys the package manager (apk) trusts, as
// LuCI's Repository Public Keys page lists them. A key is added by pasting
// it, dropping or picking its file, or giving its link; one that didn't come
// with the firmware can be removed.
import { LoaderCircleIcon, LockIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { Note } from '@/components/note';
import { LoadError } from '@/components/page-states';
import { TextDrop } from '@/components/text-drop';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApplyState } from '@/hooks/use-apply';
import { errorMessage } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { accessQueries, useAddRepoKey, useRemoveRepoKey } from '../queries';
import { fetchRepoKey } from './api';
import { checkRepoKey, fileNameFor, isBuiltIn, KEY_DIR, type RepoKey } from './model';

const isLink = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());

function KeyName({ k }: { k: RepoKey }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-mono text-xs break-all">{k.name}</span>
      {isBuiltIn(k.name) && <span className="text-xs text-muted-foreground">Comes with the firmware</span>}
    </span>
  );
}

const keyText = (k: RepoKey): ReactElement => (
  <pre className="font-mono text-xs leading-snug break-all whitespace-pre-wrap">{k.text.trim()}</pre>
);

/** A lock on the firmware's own keys; a remove button on the rest. */
function RemoveKey({ k, onRemove }: { k: RepoKey; onRemove: (k: RepoKey) => void }): ReactElement {
  return isBuiltIn(k.name) ? (
    <LockIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-label="Can’t be removed" />
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label={`Remove ${k.name}`}
      onClick={() => {
        onRemove(k);
      }}
    >
      <Trash2Icon />
    </Button>
  );
}

export function PackageKeysTab({ onStatus }: { onStatus: (s: ApplyState) => void }): ReactElement {
  const keysQuery = useQuery(accessQueries.packageKeys());
  const { data, refetch } = keysQuery;
  const error = keysQuery.error ?? undefined;
  const reload = (): void => {
    void refetch();
  };
  const addKey = useAddRepoKey();
  const removeKey = useRemoveRepoKey();
  const [input, setInput] = useState('');
  const [from, setFrom] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RepoKey>();

  const columns = useMemo(
    (): readonly Column<RepoKey>[] => [
      { label: 'Name', cell: (k) => <KeyName k={k} />, className: 'w-56' },
      { label: 'Key', cell: keyText },
      { label: 'Remove', hidden: true, cell: (k) => <RemoveKey k={k} onRemove={setRemoving} />, className: 'w-10 text-right' },
    ],
    [],
  );

  const run = async (work: () => Promise<void>, done: string): Promise<boolean> => {
    setBusy(true);
    onStatus({ phase: 'applying' });
    try {
      // the list is read again once it's written (the mutation's invalidation)
      await work();
      onStatus({ phase: 'done', nothingChanged: false, note: done });
      return true;
    } catch (err) {
      onStatus({ phase: 'failed', message: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const keys = data ?? [];
    let text = input.trim();
    let source = from ?? '';
    if (isLink(text)) {
      source = text;
      setBusy(true);
      try {
        text = (await fetchRepoKey(text)).trim();
      } catch (err) {
        setProblem(errorMessage(err));
        return;
      } finally {
        setBusy(false);
      }
    }
    const wrong = checkRepoKey(text, keys);
    if (wrong !== undefined) {
      setProblem(wrong);
      return;
    }
    const name = fileNameFor(
      source,
      keys.map((k) => k.name),
    );
    if (
      await run(() => addKey.mutateAsync({ name, text: `${text}\n` }), `Saved as ${name}: packages signed with it install now.`)
    ) {
      setInput('');
      setFrom(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== undefined && data === undefined ? (
        <LoadError error={error} retry={reload} />
      ) : (
        <Card className="pb-0">
          <CardHeading
            title="Package keys"
            description={
              <>
                The package manager installs a package only from a list signed by one of these keys. Each is a file in{' '}
                <span className="font-mono text-xs">{KEY_DIR}</span>.
              </>
            }
          />
          {data === undefined ? (
            <CardContent className="flex flex-col gap-2 pb-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </CardContent>
          ) : (
            <DataTable
              label="Package keys"
              columns={columns}
              rows={data}
              rowKey={(k) => k.name}
              card={(k) => (
                <div className="flex flex-col gap-2 px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <KeyName k={k} />
                    <RemoveKey k={k} onRemove={setRemoving} />
                  </div>
                  {keyText(k)}
                </div>
              )}
              empty="No keys: the package manager can’t install anything."
              defaultOrder="By name"
              framed={false}
              inset
              wide="md"
            />
          )}
          <CardContent className="flex flex-col gap-2 border-t py-4">
            <Note tone="warning" icon={<ShieldAlertIcon />}>
              A key here lets whoever holds its private half install anything on the router: add only a package feed’s key you
              trust.
            </Note>
            <TextDrop
              id="repo-key-add"
              label="A package key to add"
              value={input}
              onChange={(t, file) => {
                setInput(t);
                setFrom(file);
                setProblem(undefined);
              }}
              placeholder="Paste a key (-----BEGIN PUBLIC KEY-----…), or its link (https://…), or drop its file here"
              accept=".pem,.pub,text/plain"
              fileLabel="Open a key file"
              invalid={problem !== undefined}
              describedBy={problem === undefined ? undefined : 'repo-key-add-error'}
              actions={
                <Button size="sm" disabled={input.trim() === '' || busy || data === undefined} onClick={() => void add()}>
                  {busy && <LoaderCircleIcon className="animate-spin" />}
                  Add key
                </Button>
              }
            />
            {problem !== undefined && (
              <p id="repo-key-add-error" className="text-xs text-destructive">
                {problem}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <Dialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>Packages signed with it won’t install any more.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (removing === undefined) return;
                const { name } = removing;
                void run(() => removeKey.mutateAsync(name), `${name} is gone.`).then(() => {
                  setRemoving(undefined);
                });
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
