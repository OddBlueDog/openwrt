import { ChevronDownIcon, ExternalLinkIcon, LogOutIcon, SlidersHorizontalIcon } from 'lucide-react';
import { type ComponentProps, type ReactElement, useId, useState } from 'react';
import { menuFor, menuGroups } from '@/features';
import type { Feature, GroupId } from '@/features/types';
import { type Board, firmwareName } from '@/lib/api/system';
import { href, type Route } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { logout } from '@/lib/session';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

const STONE =
  'M39.1 6.6 51.9 17.4Q55 20 55.5 24L57.5 40Q58 44 55.2 46.8L44.8 57.2Q42 60 38 60H23Q19 60 16.5 56.9L8.5 47.1Q6 44 6.8 40.1L10.2 22.9Q11 19 14.4 16.9L32.6 6.1Q36 4 39.1 6.6Z';
const MILK = 'M0 37C11 30.5 21 30.5 32 35.5S52 41 64 34V64H0Z';

/** MilkFlint's mark: a flint, chipped to a point, half full of milk (docs/logo.svg). */
export function Logo({ className, ...props }: ComponentProps<'svg'>): ReactElement {
  const clip = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('size-8', className)} {...props}>
      <clipPath id={clip}>
        <path d={STONE} />
      </clipPath>
      <path
        d={STONE}
        strokeWidth="3.2"
        strokeLinejoin="round"
        className="fill-[#2e333b] stroke-[#2e333b] dark:fill-[#4b525d] dark:stroke-[#4b525d]"
      />
      <path d={MILK} fill="#fbf7ee" clipPath={`url(#${clip})`} />
    </svg>
  );
}

// shrink-0: the menu scrolls when groups are open; without it the items squash instead
const itemClass =
  'flex h-9 shrink-0 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

function NavLink({
  feature,
  active,
  nested,
  onNavigate,
}: {
  feature: Feature;
  active: boolean;
  nested?: boolean;
  onNavigate: (() => void) | undefined;
}): ReactElement {
  const Icon = feature.icon;
  return (
    <a
      href={href(feature.id)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemClass,
        nested === true && 'h-8 pl-9',
        active && 'bg-card font-medium text-foreground shadow-xs ring-1 ring-border',
      )}
    >
      {nested !== true && <Icon className={cn('size-4', active && 'text-primary')} />}
      {nested === true && <span className={cn('size-1.5 rounded-full bg-border', active && 'bg-primary')} />}
      {feature.title}
    </a>
  );
}

export function Sidebar({
  active,
  board,
  onNavigate,
}: {
  active: Route;
  board: Board | undefined;
  onNavigate?: () => void;
}): ReactElement {
  const menu = menuFor(useRouterMode());
  const activeGroup = menuGroups.find((g) => g.features.some((f) => f.id === active))?.id;
  const [open, setOpen] = useState<ReadonlySet<GroupId>>(() => new Set(activeGroup === undefined ? [] : [activeGroup]));
  const isOpen = (id: GroupId): boolean => open.has(id) || id === activeGroup;

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar px-3 py-4">
      <div className="flex items-center gap-3 px-2 pb-4">
        <Logo />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{board?.hostname ?? 'Router'}</div>
          <div className="truncate text-xs text-muted-foreground">{board?.model ?? ' '}</div>
        </div>
      </div>

      <nav aria-label="Main" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {menu.map((entry) => {
          if (entry.kind === 'page') {
            const f = entry.feature;
            return <NavLink key={f.id} feature={f} active={active === f.id} onNavigate={onNavigate} />;
          }
          const g = entry.group;
          const Icon = g.icon;
          const expanded = isOpen(g.id);
          const panel = `nav-group-${g.id}`;
          return (
            <div key={g.id} className="mt-0.5 shrink-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panel}
                onClick={() => {
                  setOpen((s) => {
                    const next = new Set(s);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  });
                }}
                className={cn(itemClass, 'w-full', g.id === activeGroup && 'text-foreground')}
              >
                <Icon className={cn('size-4', g.id === activeGroup && 'text-primary')} />
                <span className="flex-1 text-left">{g.title}</span>
                <ChevronDownIcon className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
              </button>
              {expanded && (
                <div id={panel} className="mt-0.5 flex flex-col gap-0.5">
                  {g.features.map((f) => (
                    <NavLink key={f.id} feature={f} active={active === f.id} nested onNavigate={onNavigate} />
                  ))}
                  {g.id === 'system' && (
                    <a href="/cgi-bin/luci/" target="_blank" rel="noreferrer" className={cn(itemClass, 'h-8 pl-9')}>
                      <SlidersHorizontalIcon className="-ml-0.5 size-3.5" />
                      <span className="flex-1">Advanced (LuCI)</span>
                      <ExternalLinkIcon className="size-3.5 opacity-60" />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 border-t px-1 pt-4">
        <ThemeToggle />
        <button
          type="button"
          onClick={() => void logout()}
          className="flex h-9 items-center gap-3 rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOutIcon className="size-4" />
          Log out
        </button>
        <p className="px-1.5 text-[11px] leading-snug text-muted-foreground">{firmwareName(board?.release) ?? 'MilkFlint'}</p>
      </div>
    </div>
  );
}
