// A select with a search box, for long lists (countries, time zones): type to filter by
// label, value or keywords; arrow keys, Enter and Escape as in a combobox.
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchOption {
  value: string;
  label: string;
  /** More words it's found by, e.g. "uk" for the United Kingdom. */
  keywords?: string;
}

export function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  options: readonly SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): ReactElement {
  // null: not searching, the box shows the chosen option
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const open = query !== null;
  const selected = options.find((o) => o.value === value);
  const q = (query ?? '').trim().toLowerCase();
  const shown = q === '' ? options : options.filter((o) => `${o.label} ${o.value} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  const optionId = (o: SearchOption): string => `${id}-option-${o.value}`;

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active, q]);

  const choose = (o: SearchOption | undefined): void => {
    if (o !== undefined) onChange(o.value);
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setQuery('');
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + step, 0), Math.max(shown.length - 1, 0)));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setQuery(null);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] !== undefined ? optionId(shown[active]) : undefined}
        autoComplete="off"
        spellCheck={false}
        className="pr-9"
        placeholder={open ? 'Type to search' : placeholder}
        value={query ?? selected?.label ?? ''}
        onFocus={(e) => {
          setQuery('');
          setActive(Math.max(options.findIndex((o) => o.value === value), 0));
          e.target.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setQuery(null);
        }}
      />
      <ChevronsUpDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No match</div>
          ) : (
            shown.map((o, i) => (
              <div
                key={o.value}
                id={optionId(o)}
                role="option"
                // focus stays in the search box (aria-activedescendant), not on the options
                tabIndex={-1}
                aria-selected={o.value === value}
                data-active={i === active}
                // mousedown, not click: the input's blur would close the list first
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => {
                  setActive(i);
                }}
                className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm', i === active && 'bg-accent text-accent-foreground')}
              >
                {o.label}
                {o.value === value && <CheckIcon className="size-4" />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
