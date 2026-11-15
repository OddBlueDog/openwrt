// "Is this blocked?": one box for an address, a network, a MAC address or a
// domain name. The router looks in every loaded list (and resolves a name),
// and says where it is and why, with the fix one click away: unblock it,
// always allow it, block it, end its open connections, or ask its registry
// who it belongs to.
import { BanIcon, CheckIcon, GlobeIcon, LoaderCircleIcon, SearchIcon, ShieldCheckIcon, UnplugIcon, UndoIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/utils';
import { allowAddress, endConnections, listEntry, type Registry, registryOf, type Search, search, type SetHit, unblock } from './api';
import { infoOf } from './feeds';
import { lineOwner } from './model';

function direction(h: SetHit): string {
  if (h.verdict === 'allow-only') return 'outside the allowlist';
  if (h.inbound && h.outbound) return 'both ways';
  if (h.outbound) return 'for your devices';
  return 'coming in';
}

function HitLine({ h }: { h: SetHit }): ReactElement {
  const feed = h.feed === 'blocklist' ? 'your blocklist' : h.feed === 'allowlist' ? 'your allowlist' : h.feed;
  const info = infoOf(h.feed);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-medium">{feed}</span>
      <span className="text-muted-foreground">
        {h.feed === 'allowlist' ? 'lets it through' : `blocks it ${direction(h)}`}
        {h.ports !== null && h.ports !== undefined ? `, ports ${h.ports}` : ''}
        {h.element.includes('/') || h.element.includes('-') ? ', as part of ' : ''}
      </span>
      {(h.element.includes('/') || h.element.includes('-')) && <span className="font-mono text-xs">{h.element}</span>}
      {h.packets !== null && h.packets !== undefined && h.packets > 0 && <span className="text-xs text-muted-foreground tabular">({h.packets} packets so far)</span>}
      {h.expires !== null && h.expires !== undefined && <span className="text-xs text-muted-foreground">expires in {h.expires}</span>}
      {info !== undefined && <span className="w-full text-xs text-muted-foreground">{info.text}</span>}
    </li>
  );
}

export interface LookupActionsProps {
  conntrack: boolean;
  onChanged: () => void;
}

/** The answer for one address, with what can be done about it. */
function AddressResult({
  r,
  conntrack,
  onChanged,
  redo,
}: {
  r: NonNullable<Search['results']>[number];
  conntrack: boolean;
  onChanged: () => void;
  redo: () => void;
}): ReactElement {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  const [who, setWho] = useState<Registry>();
  const blocks = r.sets.filter((s) => s.feed !== 'allowlist');
  const allowed = r.sets.some((s) => s.feed === 'allowlist') || r.allowlist.length > 0;
  const inBlocklist = r.blocklist.length > 0 || r.sets.some((s) => s.feed === 'blocklist');
  const mineAllowed = r.allowlist.filter((l) => lineOwner(l.comment) === 'you');
  const run = (what: string, fn: () => Promise<string | undefined>): void => {
    setBusy(what);
    setNote(undefined);
    fn().then(
      (msg) => {
        setBusy(undefined);
        setNote(msg);
        onChanged();
        redo();
      },
      (err: unknown) => {
        setBusy(undefined);
        setNote(errorMessage(err));
      },
    );
  };
  const spin = (what: string): ReactElement | null => (busy === what ? <LoaderCircleIcon className="animate-spin" /> : null);
  const verdict = allowed ? (blocks.length > 0 ? 'Allowed: your allowlist overrides the lists below' : 'Allowed') : blocks.length > 0 ? 'Blocked' : 'Not blocked';
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm">{r.address}</span>
        <span className={allowed ? 'text-sm font-medium text-success' : blocks.length > 0 ? 'text-sm font-medium text-primary' : 'text-sm text-muted-foreground'}>{verdict}</span>
      </div>
      {(blocks.length > 0 || r.allowlist.length > 0) && (
        <ul className="flex flex-col gap-1.5">
          {blocks.map((h) => (
            <HitLine key={h.set} h={h} />
          ))}
          {r.allowlist.map((l) => (
            <li key={`a${String(l.line)}`} className="text-sm">
              <span className="font-medium">your allowlist</span>
              <span className="text-muted-foreground">
                {' '}
                has <span className="font-mono text-xs">{l.value}</span>
                {l.comment !== null && l.comment !== undefined && l.comment !== '' ? ` (${l.comment})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {who !== undefined && (
        <p className="text-sm text-muted-foreground">
          {[who.org ?? who.name, who.country, who.network].filter((x) => x !== null && x !== undefined && x !== '').join(', ').replace(/^$/, 'The registry has no details.')}
          {who.registry !== null && who.registry !== undefined && <span className="text-xs"> (from {who.registry})</span>}
        </p>
      )}
      {note !== undefined && <p className="text-sm text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {inBlocklist && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('unblock', async () => {
                const x = await unblock(r.address);
                return x.still !== undefined && x.still.length > 0 ? `Out of your blocklist. Still on ${x.still.join(', ')}: Always allow overrides them.` : 'Out of your blocklist.';
              });
            }}
          >
            {spin('unblock') ?? <UndoIcon />} Unblock
          </Button>
        )}
        {blocks.length > 0 && !allowed && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('allow', async () => {
                await allowAddress(r.address);
                return 'Allowed: in your allowlist, ahead of every list.';
              });
            }}
          >
            {spin('allow') ?? <ShieldCheckIcon />} Always allow
          </Button>
        )}
        {mineAllowed.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('unallow', async () => {
                for (const l of mineAllowed) await listEntry('allowlist', 'remove', l.value);
                return 'Out of your allowlist.';
              });
            }}
          >
            {spin('unallow') ?? <UndoIcon />} Stop allowing
          </Button>
        )}
        {blocks.length === 0 && !allowed && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('block', async () => {
                await listEntry('blocklist', 'add', r.address, 'blocked on the banIP page');
                return 'Blocked: in your blocklist, both ways. Connections already open keep going until they end.';
              });
            }}
          >
            {spin('block') ?? <BanIcon />} Block
          </Button>
        )}
        {blocks.length > 0 && !allowed && conntrack && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('flush', async () => {
                const x = await endConnections(r.address);
                return x.ended === 0 ? 'It had no open connections.' : `Ended ${String(x.ended)} open connection${x.ended === 1 ? '' : 's'}.`;
              });
            }}
          >
            {spin('flush') ?? <UnplugIcon />} End open connections
          </Button>
        )}
        {!r.address.includes('/') && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== undefined || who !== undefined}
            onClick={() => {
              setBusy('who');
              registryOf(r.address).then(
                (x) => {
                  setBusy(undefined);
                  setWho(x);
                },
                (err: unknown) => {
                  setBusy(undefined);
                  setNote(errorMessage(err));
                },
              );
            }}
          >
            {spin('who') ?? <GlobeIcon />} Who is it?
          </Button>
        )}
      </div>
    </div>
  );
}

/** The answer to a lookup. */
export function LookupResult({ result, conntrack, onChanged, redo }: { result: Search; conntrack: boolean; onChanged: () => void; redo: () => void }): ReactElement {
  const results = result.results ?? [];
  return (
    <div className="flex flex-col gap-2">
      {result.kind === 'domain' && (
        <p className="text-sm text-muted-foreground">
          {result.query} is {results.length === 0 ? 'not found in DNS.' : `at ${results.map((r) => r.address).join(', ')}. banIP blocks addresses, so each is looked up:`}
        </p>
      )}
      {result.loaded === false && <p className="text-sm text-muted-foreground">No lists are loaded now (banIP is off or starting), so only your own lists were searched.</p>}
      {result.stale === true && (
        <p className="text-sm text-muted-foreground">banIP’s lists changed in their last update and are being read again: look again in a moment to be sure.</p>
      )}
      {results.map((r) => (
        <AddressResult key={r.address} r={r} conntrack={conntrack} onChanged={onChanged} redo={redo} />
      ))}
      {result.kind === 'mac' && (
        <p className="text-sm text-muted-foreground">
          {(result.allowlist?.length ?? 0) + (result.blocklist?.length ?? 0) === 0
            ? 'That device isn’t in your allowlist or blocklist.'
            : [
                ...(result.allowlist ?? []).map((l) => `In your allowlist: ${l.value}`),
                ...(result.blocklist ?? []).map((l) => `In your blocklist (its internet is blocked): ${l.value}`),
              ].join('. ')}
        </p>
      )}
    </div>
  );
}

/** The box, and its answer below it. */
export function LookupBox({ conntrack, onChanged, initial }: { conntrack: boolean; onChanged: () => void; initial?: string }): ReactElement {
  const [query, setQuery] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Search>();
  const [failed, setFailed] = useState<string>();
  const go = (q = query): void => {
    const t = q.trim();
    if (t === '') return;
    setBusy(true);
    setFailed(undefined);
    search(t).then(
      (r) => {
        setBusy(false);
        setResult(r);
      },
      (err: unknown) => {
        setBusy(false);
        setResult(undefined);
        setFailed(errorMessage(err));
      },
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label htmlFor="banip-lookup" className="sr-only">
          An address, network, MAC address or domain name
        </label>
        <Input
          id="banip-lookup"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="Is it blocked? An address, a network or a domain name"
          className="min-w-0 flex-1 font-mono placeholder:font-sans"
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <Button type="submit" variant="outline" disabled={busy || query.trim() === ''}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />} Look up
        </Button>
      </form>
      {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
      {result !== undefined && (
        <div className="flex flex-col gap-2">
          <LookupResult
            result={result}
            conntrack={conntrack}
            onChanged={onChanged}
            redo={() => {
              go(result.query ?? query);
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => {
              setResult(undefined);
            }}
          >
            <CheckIcon /> Done
          </Button>
        </div>
      )}
    </div>
  );
}
