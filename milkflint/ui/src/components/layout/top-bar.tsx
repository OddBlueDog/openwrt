import { Link } from '@tanstack/react-router';
import { ChevronDownIcon, EllipsisIcon, LogOutIcon, type LucideIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { menuFor, type MenuGroup } from '@/features';
import type { Board } from '@/lib/api/system';
import { pageLink, type Route } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { logout } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useDismiss } from './dismiss';
import { PageSearch } from './page-search';
import { Brand, LuciLink } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { useDecorativeIcons, useNavUnderline } from '@/lib/presentation';
import { useTheme } from '@/lib/theme';

const barItem =
  'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-sidebar-foreground transition-colors duration-fast hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
const current =
  'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground';
// presentation.navCurrent 'underline': the other entries quiet, the current one in ink and underlined
const quiet = 'text-sidebar-muted-foreground hover:text-sidebar-foreground';
const currentUnderline = 'text-sidebar-foreground underline decoration-2 underline-offset-[0.6em]';

/** The class an entry takes for being, or not being, the current page. */
function useCurrentClass(): (here: boolean) => string | undefined {
  const underline = useNavUnderline();
  return (here) => (underline ? (here ? currentUnderline : quiet) : here ? current : undefined);
}

/** A group as a menu button: its pages drop down beneath it. Escape, a click outside or a page closes it. */
function GroupMenu({ group, active }: { group: MenuGroup; active: Route }): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useId();
  const here = group.features.some((f) => f.id === active);
  const currentClass = useCurrentClass();
  const icons = useDecorativeIcons();

  useDismiss(open, setOpen, root);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={cn(barItem, currentClass(here))}
      >
        {group.title}
        <ChevronDownIcon className={cn('size-3.5 transition-transform duration-fast', open && 'rotate-180')} />
      </button>
      <div
        id={panel}
        hidden={!open}
        className="absolute top-full left-0 z-50 mt-1 min-w-56 animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {group.features.map((f) => (
          <Link
            key={f.id}
            {...pageLink(f.id)}
            aria-current={active === f.id ? 'page' : undefined}
            onClick={() => {
              setOpen(false);
            }}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
              active === f.id && 'bg-primary-subtle font-semibold text-primary-subtle-foreground',
            )}
          >
            {icons && <f.icon aria-hidden="true" className="size-4 text-muted-foreground" />}
            {f.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The menu's entries in a row: pages as links, groups as drop-down menus. */
function MenuEntries({ active }: { active: Route }): ReactElement {
  const menu = menuFor(useRouterMode());
  const currentClass = useCurrentClass();
  return (
    <>
      {menu.map((entry) =>
        entry.kind === 'page' ? (
          <Link
            key={entry.feature.id}
            {...pageLink(entry.feature.id)}
            aria-current={active === entry.feature.id ? 'page' : undefined}
            className={cn(barItem, currentClass(active === entry.feature.id))}
          >
            {entry.feature.title}
          </Link>
        ) : (
          <GroupMenu key={entry.group.id} group={entry.group} active={active} />
        ),
      )}
    </>
  );
}

/**
 * A tool as an icon button that opens a panel beneath it (the compact bar's
 * search and More). `shortcut`: ⌘K, Ctrl+K and "/" open it too, as they focus
 * the search box where it's always shown.
 */
function ToolPanel({
  label,
  icon: Icon,
  shortcut = false,
  children,
}: {
  label: string;
  icon: LucideIcon;
  shortcut?: boolean;
  children: (close: () => void) => ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useId();
  // closed from inside (Escape in the search box): focus goes back to the button, not the page
  const dismiss = useCallback((next: boolean) => {
    if (!next && root.current?.contains(document.activeElement) === true) button.current?.focus();
    setOpen(next);
  }, []);
  useDismiss(open, dismiss, root);

  useEffect(() => {
    if (!shortcut || open) return;
    const onKey = (e: KeyboardEvent): void => {
      // the bar is hidden at this width (the phone's bar is showing): leave the keys to the browser
      if (root.current === null || root.current.getClientRects().length === 0) return;
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [shortcut, open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={cn(barItem, 'px-2.5', open && 'bg-sidebar-accent')}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
      {/* always there, so aria-controls names an element; its content only while open (search focuses as it mounts) */}
      <div
        id={panel}
        hidden={!open}
        className="absolute top-full right-0 z-50 mt-1 animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)] rounded-lg border border-sidebar-border bg-sidebar p-2 text-sidebar-foreground shadow-lg"
      >
        {open &&
          children(() => {
            setOpen(false);
          })}
      </div>
    </div>
  );
}

function LogOut(): ReactElement {
  return (
    <button type="button" onClick={() => void logout()} className={cn(barItem, 'px-2.5')} aria-label="Log out">
      <LogOutIcon className="size-4" />
    </button>
  );
}

/**
 * The menu as a bar along the top, for themes whose layout puts it there
 * (wide screens only). Tools 'full': the tools on a row above the menu.
 * 'compact': one row, the menu between the product and the tools as icon
 * buttons (search, More with LuCI and light or dark, log out).
 */
export function TopBar({ active, board }: { active: Route; board: Board | undefined }): ReactElement {
  const { tools } = useTheme().theme.layout;
  if (tools === 'compact') {
    return (
      <header data-slot="sidebar" className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        {/* the window's width, not the page's: the whole menu on one row on a laptop, wrapping below that */}
        <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-(--mf-gutter) py-2">
          <Brand board={board} />
          <nav aria-label="Main" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <MenuEntries active={active} />
          </nav>
          <div className="flex shrink-0 items-center gap-0.5">
            <ToolPanel label="Search pages" icon={SearchIcon} shortcut>
              {(close) => <PageSearch focusOnOpen onNavigate={close} className="w-72" />}
            </ToolPanel>
            <ToolPanel label="More" icon={EllipsisIcon}>
              {() => (
                <div className="flex w-56 flex-col gap-2">
                  <LuciLink />
                  <ThemeToggle />
                </div>
              )}
            </ToolPanel>
            <LogOut />
          </div>
        </div>
      </header>
    );
  }
  return (
    <header data-slot="sidebar" className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex h-14 max-w-(--mf-content-max) items-center gap-3 px-(--mf-gutter)">
        <Brand board={board} />
        <span className="flex-1" />
        <PageSearch className="w-64 shrink-0" />
        <LuciLink className="px-2.5" />
        <ThemeToggle className="w-28 shrink-0" />
        <LogOut />
      </div>
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-(--mf-content-max) flex-wrap items-center gap-0.5 px-(--mf-gutter) pb-2"
      >
        <MenuEntries active={active} />
      </nav>
    </header>
  );
}
