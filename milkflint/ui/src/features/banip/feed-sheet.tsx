// Adding a list of your own, or changing one: banIP's custom feed fields
// (its web addresses for IPv4 and IPv6, how to read a line, its direction,
// its port limit), checked as banIP checks them, and tried out before it's
// saved: the router fetches the address and counts what the rule finds.
import { FlaskConicalIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatBytes, formatNumber } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import { type Feed, type FeedTest, removeFeed, saveFeed, testFeed } from './api';
import { checkFeedForm, definitionOf, type FeedForm } from './feed-form';

const RULES = [
  { value: 'feed 1', label: 'One address or network a line' },
  { value: 'feed 1 ,', label: 'Comma-separated, the address first' },
  { value: 'feed 13', label: 'Address, then its prefix length, in columns 1 and 3' },
  { value: 'feed 4 "', label: 'JSON lines, the address the 4th quoted field' },
  { value: 'suricata 1', label: 'Suricata or Snort rules' },
];

export function FeedSheet({
  feed,
  names,
  onClose,
  onSaved,
}: {
  feed: Feed | undefined;
  names: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const id = useId();
  const [f, setF] = useState<FeedForm>({
    name: feed?.name ?? '',
    descr: feed?.descr ?? '',
    url_4: feed?.url_4 ?? '',
    url_6: feed?.url_6 ?? '',
    rule: feed?.rule ?? 'feed 1',
    chain: feed?.chain === 'out' || feed?.chain === 'inout' ? feed.chain : 'in',
    flag: feed?.flag ?? '',
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [test, setTest] = useState<FeedTest>();
  const errors = checkFeedForm(f, names, feed !== undefined);
  const show = (k: keyof FeedForm): string | undefined => (tried ? errors[k] : undefined);
  const set = <K extends keyof FeedForm>(k: K, v: FeedForm[K]): void => {
    setF((x) => ({ ...x, [k]: v }));
  };
  const run = (what: string, fn: () => Promise<unknown>, after?: () => void): void => {
    setBusy(what);
    setFailed(undefined);
    fn().then(
      () => {
        setBusy(undefined);
        after?.();
      },
      (err: unknown) => {
        setBusy(undefined);
        setFailed(errorMessage(err));
      },
    );
  };
  const field = (k: keyof FeedForm, label: string, hint: string, input: ReactElement): ReactElement => (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-${k}`} className="text-sm font-medium">
        {label}
      </label>
      {input}
      {show(k) !== undefined && <p className="text-xs text-destructive">{show(k)}</p>}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`}>
        <div className="border-b px-6 py-4">
          <SheetTitle className="pr-8">{feed === undefined ? 'Add a list' : `Change ${feed.name}`}</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5 text-xs">
            Any web page with addresses on it, downloaded at each update. It’s kept in banIP’s custom feed file, with banIP’s own
            lists.
          </SheetDescription>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {field(
            'name',
            'Name',
            'Small letters and digits; it names the list’s sets (name.v4, name.v6).',
            <Input
              id={`${id}-name`}
              value={f.name}
              disabled={feed !== undefined}
              className="font-mono"
              onChange={(e) => {
                set('name', e.target.value.toLowerCase());
              }}
            />,
          )}
          {field(
            'descr',
            'Description',
            'A few words, shown with it.',
            <Input
              id={`${id}-descr`}
              value={f.descr}
              onChange={(e) => {
                set('descr', e.target.value);
              }}
            />,
          )}
          {field(
            'url_4',
            'Address of the IPv4 list',
            'Leave it empty if the list has only IPv6.',
            <Input
              id={`${id}-url_4`}
              value={f.url_4}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="https://example.org/blocklist.txt"
              onChange={(e) => {
                set('url_4', e.target.value.trim());
              }}
            />,
          )}
          {field(
            'url_6',
            'Address of the IPv6 list',
            'The same address for a list with both, read once.',
            <Input
              id={`${id}-url_6`}
              value={f.url_6}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(e) => {
                set('url_6', e.target.value.trim());
              }}
            />,
          )}
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-rule`} className="text-sm font-medium">
              How to read a line
            </label>
            <Select
              value={RULES.some((r) => r.value === f.rule) ? f.rule : '__own'}
              onValueChange={(v) => {
                if (v !== '__own') set('rule', v);
              }}
            >
              <SelectTrigger id={`${id}-rule`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
                <SelectItem value="__own">A rule of my own</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="The rule"
              value={f.rule}
              className="font-mono text-xs"
              onChange={(e) => {
                set('rule', e.target.value);
              }}
            />
            {show('rule') !== undefined && <p className="text-xs text-destructive">{show('rule')}</p>}
            <p className="text-xs text-muted-foreground">
              banIP’s rule: feed or suricata, then optionally a text a line must start with, the column of the address, and a
              separator.
            </p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-chain`} className="text-sm font-medium">
              Direction
            </label>
            <Select
              value={f.chain}
              onValueChange={(v) => {
                set('chain', v as FeedForm['chain']);
              }}
            >
              <SelectTrigger id={`${id}-chain`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">In: what these addresses send you</SelectItem>
                <SelectItem value="out">Out: your devices reaching them</SelectItem>
                <SelectItem value="inout">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field(
            'flag',
            'Options',
            '“gz” for a compressed list; “tcp udp 80 443” to block only those ports.',
            <Input
              id={`${id}-flag`}
              value={f.flag}
              className="font-mono text-xs"
              onChange={(e) => {
                set('flag', e.target.value.replace(/\s+/g, ' ').trimStart());
              }}
            />,
          )}
          <div className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Try it</p>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy !== undefined ||
                  (f.url_4 === '' && f.url_6 === '') ||
                  errors.url_4 !== undefined ||
                  errors.url_6 !== undefined ||
                  errors.rule !== undefined
                }
                onClick={() => {
                  setTest(undefined);
                  run('test', async () => {
                    setTest(await testFeed(f.url_4 !== '' ? f.url_4 : f.url_6, f.rule, f.flag));
                  });
                }}
              >
                {busy === 'test' ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />} Fetch and count
              </Button>
            </div>
            {test === undefined ? (
              <p className="text-xs text-muted-foreground">
                The router downloads it (up to 2 MB) and counts the addresses the rule finds.
              </p>
            ) : test.reachable === true ? (
              <p className="text-sm">
                {formatBytes(test.bytes ?? 0)}
                {test.truncated === true ? ' (the first 2 MB)' : ''}: {formatNumber(test.v4 ?? 0)} IPv4 and{' '}
                {formatNumber(test.v6 ?? 0)} IPv6 entries
                {(test.sample ?? []).length > 0 && (
                  <span className="block font-mono text-xs text-muted-foreground">{(test.sample ?? []).join(', ')}</span>
                )}
                {(test.v4 ?? 0) + (test.v6 ?? 0) === 0 && (
                  <span className="block text-xs text-warning">Nothing found: check how to read a line.</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-destructive">
                Couldn’t fetch it{test.error !== undefined && test.error !== 'empty' ? `: ${test.error}` : ' (nothing came back)'}
                .
              </p>
            )}
          </div>
          {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          {feed !== undefined ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy !== undefined}
              onClick={() => {
                run('remove', () => removeFeed(feed.name), onSaved);
              }}
            >
              <Trash2Icon /> {feed.builtin ? 'Back to banIP’s' : 'Remove'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy !== undefined}
              onClick={() => {
                setTried(true);
                if (Object.keys(errors).length === 0) run('save', () => saveFeed(f.name, definitionOf(f)), onSaved);
              }}
            >
              {busy === 'save' && <LoaderCircleIcon className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
