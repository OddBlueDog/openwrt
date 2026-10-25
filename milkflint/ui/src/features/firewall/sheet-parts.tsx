// What the Firewall page's side sheets share: labels that name the UCI
// option a field sets, and the section as the file will hold it.
import { CheckIcon, CopyIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Change, Section } from '@/lib/api/uci';

/** The UCI option a field sets, as LuCI's advanced users know it. */
export function Opt({ children }: { children: ReactNode }): ReactElement {
  return <code className="rounded border bg-muted px-1 py-px font-mono text-[10px] font-normal text-muted-foreground">{children}</code>;
}

export function FieldLabel({ htmlFor, label, opt }: { htmlFor?: string; label: string; opt: string }): ReactElement {
  return (
    <span className="flex items-center gap-2 text-sm font-medium">
      {htmlFor === undefined ? label : <label htmlFor={htmlFor}>{label}</label>}
      <Opt>{opt}</Opt>
    </span>
  );
}

const quote = (v: string): string => `'${v.replaceAll("'", "'\\''")}'`;

/** The section as /etc/config/firewall will hold it once the changes are applied. */
function previewLines(type: string, original: Section | undefined, changes: readonly Change[]): string[] {
  const merged = new Map<string, string | string[]>();
  for (const [k, v] of Object.entries(original ?? {})) if (!k.startsWith('.') && v !== undefined && typeof v !== 'boolean' && typeof v !== 'number') merged.set(k, v);
  // only this section's: a sheet's changes can touch others (a zone's forwardings)
  const name = original?.['.name'];
  for (const c of changes) {
    if (c.op === 'add' && name === undefined && c.type === type) for (const [k, v] of Object.entries(c.values)) merged.set(k, v);
    else if (c.op === 'set' && c.section === name) for (const [k, v] of Object.entries(c.values)) merged.set(k, v);
    else if (c.op === 'unset' && c.section === name) for (const k of c.options) merged.delete(k);
  }
  const lines = [`config ${type}${original === undefined ? '' : ` ${quote(original['.name'])}`}`];
  for (const [k, v] of merged) {
    if (Array.isArray(v)) for (const x of v) lines.push(`\tlist ${k} ${quote(x)}`);
    else lines.push(`\toption ${k} ${quote(v)}`);
  }
  return lines;
}

function copyText(text: string): void {
  // the router's page is plain http, where the clipboard API isn't there
  if (window.isSecureContext && 'clipboard' in navigator) {
    void navigator.clipboard.writeText(text);
    return;
  }
  const t = document.createElement('textarea');
  t.value = text;
  document.body.append(t);
  t.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one way to copy on a plain-http page
  document.execCommand('copy');
  t.remove();
}

/** The section a sheet edits, as it will be in the file once saved, with a copy button. */
export function UciPreview({ type, original, changes }: { type: string; original: Section | undefined; changes: readonly Change[] }): ReactElement {
  const [copied, setCopied] = useState(false);
  const lines = previewLines(type, original, changes);
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">/etc/config/firewall</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Copy"
          onClick={() => {
            copyText(lines.join('\n'));
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, 1500);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <pre className="overflow-x-auto py-2 font-mono text-xs leading-5">
        {lines.map((l, i) => {
          const m = /^(\t?)(config|option|list) (\S+)(?: (.*))?$/.exec(l);
          return (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 pr-3 text-right text-muted-foreground/60 select-none">{i + 1}</span>
              {m === null ? (
                <span>{l}</span>
              ) : (
                <span className={m[1] === '' ? '' : 'pl-4'}>
                  <span className="text-primary">{m[2]}</span> {m[2] === 'config' ? m[3] : <span>{m[3]}</span>}
                  {m[4] !== undefined && <span className="text-success"> {m[4]}</span>}
                </span>
              )}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

