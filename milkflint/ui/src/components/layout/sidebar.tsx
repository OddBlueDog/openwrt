import { ChevronDownIcon, ExternalLinkIcon, LogOutIcon } from 'lucide-react';
import { type ComponentProps, type ReactElement, useEffect, useId, useState } from 'react';
import { menuBands, menuFor, type MenuGroup } from '@/features';
import type { Feature, GroupId } from '@/features/types';
import { type Board, firmwareName } from '@/lib/api/system';
import { href, type Route } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { logout } from '@/lib/session';
import { cn } from '@/lib/utils';
import { PageSearch } from './page-search';
import { ThemeToggle } from './theme-toggle';
import { useDecorativeIcons } from '@/lib/presentation';

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
      <path d={STONE} strokeWidth="3.2" strokeLinejoin="round" className="fill-brand-stone stroke-brand-stone" />
      <path d={MILK} className="fill-brand-milk" clipPath={`url(#${clip})`} />
    </svg>
  );
}

/** MilkFlint's stylized wordmark: tight bold tracking with a primary circle spark over the i in Flint. */
export function Wordmark({ className }: { className?: string }): ReactElement {
  return (
    <span className={cn('inline-flex items-baseline leading-none font-bold tracking-[-0.042em]', className)}>
      <span className="sr-only">MilkFlint</span>
      <span aria-hidden="true" className="inline-flex items-baseline">
        MilkFl
        <span className="relative inline-block">
          {'\u0131'}
          <span className="absolute top-[0.07em] left-1/2 size-[0.165em] -translate-x-1/2 rounded-full bg-primary" />
        </span>
        nt
      </span>
    </span>
  );
}

/**
 * The product's name and the router's, as the rail and the top bar show them:
 * its hostname, or its model while the hostname is the firmware's own name
 * (the one it comes with), which would say the name twice.
 */
export function Brand({ board }: { board: Board | undefined }): ReactElement {
  const product = board?.release?.distribution ?? 'MilkFlint';
  const named = board !== undefined && board.hostname.toLowerCase() !== product.toLowerCase() ? board.hostname : undefined;
  return (
    <a href={href('dashboard')} className="flex min-w-0 items-center gap-3 rounded-lg">
      <Logo className="size-8 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <Wordmark className="text-sm" />
        <span className="block truncate text-xs text-sidebar-muted-foreground">{named ?? board?.model ?? 'Router'}</span>
      </span>
    </a>
  );
}

const itemClass =
  'flex h-9 shrink-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground transition-colors duration-fast hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';

export function NavLink({
  feature,
  active,
  nested = false,
  onNavigate,
}: {
  feature: Feature;
  active: boolean;
  nested?: boolean;
  onNavigate: (() => void) | undefined;
}): ReactElement {
  const Icon = feature.icon;
  const icons = useDecorativeIcons();
  return (
    <a
      href={href(feature.id)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemClass,
        nested && 'h-8 pl-9 font-normal',
        active &&
          'bg-sidebar-primary font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
      )}
    >
      {!nested && icons && (
        <Icon className={cn('size-4 text-sidebar-muted-foreground', active && 'text-sidebar-primary-foreground')} />
      )}
      <span className="truncate">{feature.title}</span>
    </a>
  );
}

export function LuciLink({ className }: { className?: string }): ReactElement {
  return (
    <a href="/cgi-bin/luci/" target="_blank" rel="noreferrer" className={cn(itemClass, className)}>
      <span className="flex-1">Open LuCI</span>
      <ExternalLinkIcon className="size-3.5 text-sidebar-muted-foreground" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Which group is open: one at a time, so the rail fits a laptop screen. The
 * current page's group starts open; opening another closes it.
 */
function useOpenGroup(activeGroup: GroupId | undefined): [(id: GroupId) => boolean, (id: GroupId) => void] {
  const [open, setOpen] = useState<GroupId | undefined>(activeGroup);
  const [seen, setSeen] = useState(activeGroup);
  // a page in another group: that group opens
  if (seen !== activeGroup) {
    setSeen(activeGroup);
    setOpen(activeGroup);
  }
  return [
    (id) => open === id,
    (id) => {
      setOpen((o) => (o === id ? undefined : id));
    },
  ];
}

/** True while the element has more below than it shows, so the rail can say so. */
function useMoreBelow(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (el === null) return;
    const check = (): void => {
      setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [el]);
  return [setEl, more];
}

function GroupSection({
  group,
  active,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: MenuGroup;
  active: Route;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (() => void) | undefined;
}): ReactElement {
  const Icon = group.icon;
  const icons = useDecorativeIcons();
  const panel = useId();
  const current = group.features.some((f) => f.id === active);
  return (
    <div className="shrink-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panel}
        onClick={onToggle}
        className={cn(itemClass, 'w-full', current && 'text-sidebar-accent-foreground')}
      >
        {icons && <Icon className="size-4 text-sidebar-muted-foreground" />}
        <span className="flex-1 text-left">{group.title}</span>
        <ChevronDownIcon
          className={cn('size-4 text-sidebar-muted-foreground transition-transform duration-fast', expanded && 'rotate-180')}
        />
      </button>
      <div id={panel} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5 pb-1">
        {group.features.map((f) => (
          <NavLink key={f.id} feature={f} active={active === f.id} nested onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

/** The menu as a rail: the product, a search, the pages in three bands, and the footer. */
export function Sidebar({
  active,
  board,
  onNavigate,
}: {
  active: Route;
  board: Board | undefined;
  onNavigate?: () => void;
}): ReactElement {
  const bands = menuBands(menuFor(useRouterMode()));
  const activeGroup = bands
    .flatMap((b) => b.entries)
    .find((e) => e.kind === 'group' && e.group.features.some((f) => f.id === active));
  const [isOpen, toggle] = useOpenGroup(activeGroup?.kind === 'group' ? activeGroup.group.id : undefined);
  const [navRef, moreBelow] = useMoreBelow();

  return (
    <div data-slot="sidebar" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col gap-4 px-3 pt-4 pb-3">
        <div className="px-1.5">
          <Brand board={board} />
        </div>
        <PageSearch {...(onNavigate !== undefined ? { onNavigate } : {})} />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <nav ref={navRef} aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
          {bands.map(({ band, entries }, i) => (
            <div key={band} className={cn('flex flex-col gap-0.5', i > 0 && 'mt-3 border-t border-sidebar-border pt-3')}>
              {entries.map((entry) =>
                entry.kind === 'page' ? (
                  <NavLink
                    key={entry.feature.id}
                    feature={entry.feature}
                    active={active === entry.feature.id}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <GroupSection
                    key={entry.group.id}
                    group={entry.group}
                    active={active}
                    expanded={isOpen(entry.group.id)}
                    onToggle={() => {
                      toggle(entry.group.id);
                    }}
                    onNavigate={onNavigate}
                  />
                ),
              )}
            </div>
          ))}
        </nav>
        {/* more of the menu below: a fade and a hairline say so */}
        {moreBelow && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-sidebar to-transparent"
          />
        )}
      </div>

      <div
        className={cn(
          'flex flex-col gap-2 border-t px-3 pt-2.5 pb-3',
          moreBelow ? 'border-sidebar-ring/40' : 'border-sidebar-border',
        )}
      >
        <div className="flex items-center gap-1">
          <LuciLink className="flex-1" />
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Log out"
            title="Log out"
            className={cn(itemClass, 'px-2.5')}
          >
            <LogOutIcon className="size-4 text-sidebar-muted-foreground" />
          </button>
        </div>
        <ThemeToggle />
        <p className="px-1 text-xs text-sidebar-muted-foreground">{firmwareName(board?.release) ?? 'MilkFlint'}</p>
      </div>
    </div>
  );
}
