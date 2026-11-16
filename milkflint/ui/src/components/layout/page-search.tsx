import { CornerDownLeftIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputClass } from '@/components/ui/input';
import { groupOf, menuFor } from '@/features';
import { searchPages } from '@/features/search';
import type { Feature } from '@/features/types';
import { href } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { cn } from '@/lib/utils';
import { useDecorativeIcons } from '@/lib/presentation';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Find a page by name or by another word for it ("qos", "ssid", "port").
 * ⌘K or Ctrl+K (or /) jumps here from anywhere; arrows pick, Enter goes.
 */
export function PageSearch({
  onNavigate,
  className,
  focusOnOpen = false,
}: {
  onNavigate?: () => void;
  className?: string;
  /** Focus the box when it appears (the compact bar's search opens it on demand). */
  focusOnOpen?: boolean;
}): ReactElement {
  const menu = menuFor(useRouterMode());
  const icons = useDecorativeIcons();
  const pages = useMemo(() => menu.flatMap((e): Feature[] => (e.kind === 'page' ? [e.feature] : [...e.group.features])), [menu]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const results = searchPages(query, pages, groupOf);
  const open = query.trim() !== '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        // the first visible search box (the rail's or the top bar's)
        if (input.current !== null && input.current.offsetParent !== null) {
          e.preventDefault();
          input.current.focus();
          input.current.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);

  const go = (feature: Feature): void => {
    window.location.hash = href(feature.id);
    setQuery('');
    input.current?.blur();
    onNavigate?.();
  };

  return (
    <div className={cn('relative', className)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-sidebar-muted-foreground"
      />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Find a page"
        aria-expanded={open}
        aria-controls={list}
        aria-activedescendant={open && results[active] !== undefined ? `${list}-${String(active)}` : undefined}
        placeholder="Find a page"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            const hit = results[active];
            if (hit !== undefined) go(hit.feature);
          } else if (e.key === 'Escape') {
            setQuery('');
          }
        }}
        onBlur={() => {
          // let a click on a result land first
          window.setTimeout(() => {
            setQuery('');
          }, 150);
        }}
        className={cn(
          inputClass,
          'h-9 border-sidebar-border bg-sidebar pr-12 pl-8 text-sidebar-foreground shadow-none placeholder:text-sidebar-muted-foreground [&::-webkit-search-cancel-button]:hidden',
        )}
      />
      <kbd className="rounded pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 border border-sidebar-border px-1.5 font-sans text-xs text-sidebar-muted-foreground">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
      {open && (
        <div
          id={list}
          role="listbox"
          aria-label="Pages"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {results.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">No page matches “{query.trim()}”</p>}
          {results.map((r, i) => (
            <div
              key={r.feature.id}
              id={`${list}-${String(i)}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r.feature);
              }}
              onMouseEnter={() => {
                setActive(i);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              {icons && <r.feature.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-medium">{r.feature.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{r.group?.title ?? ''}</span>
              {i === active && <CornerDownLeftIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
