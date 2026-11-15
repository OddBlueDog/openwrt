// The banIP page's Lists tab: your allowlist (always let through, ahead of
// every list) and your blocklist (always blocked, both ways), edited as
// banIP's files are: one address, network, MAC address or domain name a
// line, "#" for a comment. Each line is checked as you type (the gutter
// marks it), the blocklist's against your own networks too; a save goes
// into the loaded sets at once as well as the file. The lines MilkFlint and
// banIP keep up themselves are marked.
import { DownloadIcon, ListChecksIcon, LoaderCircleIcon, PlusIcon, ShieldCheckIcon, ShieldXIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { type ChangeEvent, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { FormSkeleton } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ApplyState } from '@/hooks/use-apply';
import { formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { type BanipConfig, getList, listEntry, type ListName, saveList, saveOptions } from './api';
import { ENTRY_PROBLEMS, formatEntry, insideConflicts, lineOwner, parseEntry, summarize } from './model';
import { effective, ITEMS, type Options, optionChanges } from './options';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const TEXT: Record<ListName, { title: string; description: string; empty: string; icon: typeof ShieldCheckIcon }> = {
  allowlist: {
    title: 'Allowlist',
    description: 'Always let through, ahead of every list: addresses, networks, devices (MAC addresses) and domain names.',
    empty: 'Nothing allowed yet. Add an address that a list blocks by mistake, or use Always allow from a lookup or the Activity tab.',
    icon: ShieldCheckIcon,
  },
  blocklist: {
    title: 'Blocklist',
    description: 'Always blocked, both ways. A device’s MAC address here loses its internet access (not the router’s pages).',
    empty: 'Nothing blocked by hand yet. banIP’s log monitor adds addresses here too, when they fail to sign in.',
    icon: ShieldXIcon,
  },
};

function ListEditor({ list, c, onSaved }: { list: ListName; c: BanipConfig; onSaved: () => void }): ReactElement {
  const t = TEXT[list];
  const [saved, setSaved] = useState<string>();
  const [text, setText] = useState('');
  const [tooBig, setTooBig] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  const [quick, setQuick] = useState('');
  const [importing, setImporting] = useState<string>();
  const gutter = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = (): void => {
    getList(list).then(
      (r) => {
        setSaved(r.text);
        setText(r.text);
        setTooBig(r.tooBig);
      },
      (err: unknown) => {
        setLoadError(errorMessage(err));
      },
    );
  };
  useEffect(load, [list]);
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  const entries = useMemo(() => lines.map(parseEntry), [lines]);
  const summary = summarize(entries);
  const problems = entries.map((e, i) => ({ e, line: i + 1 })).filter((x) => x.e.kind === 'invalid');
  const conflicts = list === 'blocklist' ? insideConflicts(entries, c.inside ?? []) : [];
  const dirty = saved !== undefined && text !== saved;
  const q = parseEntry(quick.trim());
  const quickOk = ['v4', 'v6', 'mac', 'domain'].includes(q.kind);
  const save = (): void => {
    setState({ phase: 'applying' });
    const body = lines.map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');
    saveList(list, body === '' ? '' : `${body}\n`).then(
      (r) => {
        setState({
          phase: 'done',
          nothingChanged: false,
          note:
            r.pending === true
              ? `Saved. With big lists loaded, the change takes a few seconds to reach them (${String(r.added ?? 0)} to add, ${String(r.removed ?? 0)} to take out).`
              : r.applied === true
                ? `In effect now: ${String(r.added ?? 0)} added, ${String(r.removed ?? 0)} taken out of the loaded lists.`
                : 'Saved: banIP reads it when it next starts.',
        });
        load();
        onSaved();
      },
      (err: unknown) => {
        setState({ phase: 'failed', message: errorMessage(err) });
      },
    );
  };
  if (loadError !== undefined) return <p className="text-sm text-destructive">{loadError}</p>;
  if (saved === undefined) return <FormSkeleton />;
  return (
    <Card>
      <CardHeading
        icon={t.icon}
        title={t.title}
        description={t.description}
        action={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                download(`banip.${list}.txt`, text);
              }}
            >
              <DownloadIcon /> Export
            </Button>
            {!tooBig && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  file.current?.click();
                }}
              >
                <UploadIcon /> Import
              </Button>
            )}
            <input
              ref={file}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0];
                if (f !== undefined)
                  void f.text().then((x) => {
                    setImporting(x);
                  });
                e.target.value = '';
              }}
            />
          </>
        }
      />
      <CardContent className="flex flex-col gap-3">
        <ApplyStatus state={state} />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quickOk) return;
            if (tooBig) {
              setState({ phase: 'applying' });
              listEntry(list, 'add', quick.trim()).then(
                () => {
                  setState({ phase: 'done', nothingChanged: false, note: 'Added, and in effect now.' });
                  setQuick('');
                  load();
                },
                (err: unknown) => {
                  setState({ phase: 'failed', message: errorMessage(err) });
                },
              );
              return;
            }
            setText((x) => `${x.replace(/\n*$/, '')}${x.trim() === '' ? '' : '\n'}${formatEntry(quick.trim().toLowerCase())}\n`);
            setQuick('');
          }}
        >
          <Input
            aria-label={`Add to the ${list}`}
            value={quick}
            placeholder="Add an address, network, MAC address or domain name"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono placeholder:font-sans"
            aria-invalid={quick.trim() !== '' && !quickOk}
            onChange={(e) => {
              setQuick(e.target.value);
            }}
          />
          <Button type="submit" variant="outline" disabled={!quickOk}>
            <PlusIcon /> Add
          </Button>
        </form>
        {quick.trim() !== '' && !quickOk && <p className="text-xs text-destructive">{ENTRY_PROBLEMS[q.reason ?? 'unknown'] ?? ENTRY_PROBLEMS['unknown']}</p>}
        {tooBig ? (
          <p className="text-sm text-muted-foreground">
            This list is too big to edit here ({formatNumber(Math.round(saved.length / 1024))} KB). Export it to look through it; adding one entry above still
            works.
          </p>
        ) : (
          <div className="flex h-80 overflow-hidden rounded-md border bg-card focus-within:ring-2 focus-within:ring-ring">
            <div ref={gutter} aria-hidden="true" className="w-12 shrink-0 overflow-hidden border-r bg-muted/40 py-2 text-right font-mono text-xs leading-5">
              {entries.map((e, i) => {
                const owner = lineOwner(e.comment);
                const conflict = conflicts.some((x) => x.value === e.value);
                return (
                  <div
                    key={i}
                    className={cn(
                      'pr-2',
                      e.kind === 'invalid' || conflict ? 'bg-destructive/15 text-destructive' : owner !== 'you' && e.kind !== 'comment' && e.kind !== 'blank' ? 'text-muted-foreground/60' : 'text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
            <textarea
              aria-label={`The ${list}, one entry a line`}
              value={text}
              spellCheck={false}
              wrap="off"
              className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
              placeholder={t.empty}
              onScroll={(e) => {
                if (gutter.current !== null) gutter.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground tabular">
          {[
            summary.addresses > 0 && `${formatNumber(summary.addresses)} addresses`,
            summary.networks > 0 && `${formatNumber(summary.networks)} networks`,
            summary.devices > 0 && `${formatNumber(summary.devices)} devices`,
            summary.names > 0 && `${formatNumber(summary.names)} domain names`,
          ]
            .filter((x) => x !== false)
            .join(', ')
            .replace(/^$/, 'Empty')}
          {summary.managed > 0 && `. ${String(summary.managed)} kept up by MilkFlint and banIP (your networks, the internet connection): changes to those come back`}
          .
        </p>
        {problems.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-destructive">
            {problems.slice(0, 5).map((p) => (
              <li key={p.line}>
                Line {p.line}: {ENTRY_PROBLEMS[p.e.reason ?? 'unknown'] ?? 'Not an entry banIP takes.'}
              </li>
            ))}
            {problems.length > 5 && <li>And {problems.length - 5} more.</li>}
          </ul>
        )}
        {conflicts.length > 0 && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {conflicts
              .slice(0, 3)
              .map((x) => `${x.value} is on your own network (${x.iface})`)
              .join('; ')}
            : the router won’t save that.
          </p>
        )}
        {dirty && (
          <div className="flex items-center justify-end gap-2 border-t pt-3">
            <p className="mr-auto text-xs text-muted-foreground">{problems.length > 0 || conflicts.length > 0 ? 'Fix the marked lines to save.' : 'Not saved yet.'}</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={state.phase === 'applying'}
              onClick={() => {
                setText(saved);
                setState({ phase: 'idle' });
              }}
            >
              Discard
            </Button>
            <Button size="sm" disabled={state.phase === 'applying' || problems.length > 0 || conflicts.length > 0} onClick={save}>
              {state.phase === 'applying' && <LoaderCircleIcon className="animate-spin" />}
              Save &amp; apply
            </Button>
          </div>
        )}
      </CardContent>
      <Dialog
        open={importing !== undefined}
        onOpenChange={(o) => {
          if (!o) setImporting(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import into the {list}</DialogTitle>
            <DialogDescription>
              {formatNumber((importing ?? '').split('\n').filter((l) => l.trim() !== '').length)} lines. Add them to what’s there, or replace it? Nothing is saved
              until you save.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setText(importing ?? '');
                setImporting(undefined);
              }}
            >
              Replace
            </Button>
            <Button
              onClick={() => {
                setText((x) => `${x.replace(/\n*$/, '')}${x.trim() === '' ? '' : '\n'}${(importing ?? '').replace(/\r/g, '').replace(/\n*$/, '')}\n`);
                setImporting(undefined);
              }}
            >
              Add them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const URL_RE = new RegExp(ITEMS.url);

function AllowOptions({ c, onSaved }: { c: BanipConfig; onSaved: () => void }): ReactElement {
  const saved: Options = {
    ban_autoallowlist: c.options?.['ban_autoallowlist'] ?? null,
    ban_autoallowuplink: c.options?.['ban_autoallowuplink'] ?? null,
    ban_allowurl: c.options?.['ban_allowurl'] ?? null,
    ban_allowlistonly: c.options?.['ban_allowlistonly'] ?? null,
    ban_monitorallowed: c.options?.['ban_monitorallowed'] ?? null,
  };
  const [o, setO] = useState<Options>(saved);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  const [confirmOnly, setConfirmOnly] = useState(false);
  const changes = optionChanges(saved, o);
  const urls = effective(o, 'ban_allowurl') as readonly string[];
  const only = effective(o, 'ban_allowlistonly') === '1';
  const save = (): void => {
    setState({ phase: 'applying' });
    saveOptions(changes).then(
      () => {
        setState({ phase: 'done', nothingChanged: false, note: c.enabled === true ? 'banIP is loading its lists again with these.' : undefined });
        onSaved();
      },
      (err: unknown) => {
        setState({ phase: 'failed', message: errorMessage(err) });
      },
    );
  };
  return (
    <Card>
      <CardHeading icon={ListChecksIcon} title="What the allowlist does" />
      <CardContent className="flex flex-col gap-2">
        <ApplyStatus state={state} />
        <div className="divide-y">
          <Field id="banip-autoallow" label="Keep it up to date" hint="Adds your internet connection’s own addresses, and the addresses of the domain names in it, at each update.">
            <Switch
              id="banip-autoallow"
              checked={effective(o, 'ban_autoallowlist') === '1'}
              onCheckedChange={(v) => {
                setO({ ...o, ban_autoallowlist: v ? '1' : '0' });
              }}
            />
          </Field>
          <Field id="banip-uplink" label="Your internet connection" hint="So nothing on your provider’s side of the line is blocked. The whole subnet is banIP’s default.">
            <Select
              value={effective(o, 'ban_autoallowuplink') as string}
              disabled={effective(o, 'ban_autoallowlist') !== '1'}
              onValueChange={(v) => {
                setO({ ...o, ban_autoallowuplink: v });
              }}
            >
              <SelectTrigger id="banip-uplink">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subnet">Its whole subnet</SelectItem>
                <SelectItem value="ip">Its address only</SelectItem>
                <SelectItem value="disable">Not added</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="banip-allowurl" label="Allowlists from the internet" hint="Web addresses of lists to allow as well, e.g. a country’s networks in allowlist-only mode.">
            <div className="flex flex-col gap-2">
              {urls.map((u) => (
                <div key={u} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{u}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setO({ ...o, ban_allowurl: urls.filter((x) => x !== u) });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (URL_RE.test(url) && !urls.includes(url)) setO({ ...o, ban_allowurl: [...urls, url] });
                  setUrl('');
                }}
              >
                <Input
                  id="banip-allowurl"
                  value={url}
                  placeholder="https://"
                  className="font-mono text-xs"
                  aria-invalid={url !== '' && !URL_RE.test(url)}
                  onChange={(e) => {
                    setUrl(e.target.value.trim());
                  }}
                />
                <Button type="submit" variant="outline" disabled={!URL_RE.test(url)}>
                  Add
                </Button>
              </form>
            </div>
          </Field>
          <Field
            id="banip-only"
            label="Allowlist only"
            hint="Blocks the whole internet except what the allowlist holds, both ways. For a device or network that should reach a few places only."
          >
            <Switch
              id="banip-only"
              checked={only}
              onCheckedChange={(v) => {
                if (v) setConfirmOnly(true);
                else setO({ ...o, ban_allowlistonly: '0' });
              }}
            />
          </Field>
          {only && (
            <Field id="banip-monitorallowed" label="Watch allowed addresses too" hint="The log monitor may block an attacker inside an allowed range; your own allowlist entries stay exempt.">
              <Switch
                id="banip-monitorallowed"
                checked={effective(o, 'ban_monitorallowed') === '1'}
                onCheckedChange={(v) => {
                  setO({ ...o, ban_monitorallowed: v ? '1' : '0' });
                }}
              />
            </Field>
          )}
        </div>
        {Object.keys(changes).length > 0 && (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setO(saved);
              }}
            >
              Discard
            </Button>
            <Button disabled={state.phase === 'applying'} onClick={save}>
              {state.phase === 'applying' && <LoaderCircleIcon className="animate-spin" />}
              Save &amp; apply
            </Button>
          </div>
        )}
      </CardContent>
      <Dialog open={confirmOnly} onOpenChange={setConfirmOnly}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block everything but the allowlist?</DialogTitle>
            <DialogDescription>
              Every device loses the internet except the addresses in your allowlist (and its lists from the internet), both ways. The router itself,
              its pages and Remote access keep working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmOnly(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setO({ ...o, ban_allowlistonly: '1' });
                setConfirmOnly(false);
              }}
            >
              Allowlist only
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function ListsTab({ c, onSaved }: { c: BanipConfig; onSaved: () => void }): ReactElement {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <ListEditor list="allowlist" c={c} onSaved={onSaved} />
      <ListEditor list="blocklist" c={c} onSaved={onSaved} />
      <div className="xl:col-span-2">
        <AllowOptions c={c} onSaved={onSaved} />
      </div>
    </div>
  );
}
