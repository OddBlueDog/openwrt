import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MenuIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { usePoll } from '@/hooks/use-poll';
import { getBoard } from '@/lib/api/system';
import type { Route } from '@/lib/router';
import { refreshRouterMode } from '@/lib/router-mode';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { PasswordBar } from './password-bar';
import { Logo, Sidebar } from './sidebar';
import { useStickyOffset } from './sticky-offset';
import { TopBar } from './top-bar';
import { syncThemes } from '@/lib/theme';

/**
 * The frame around every page. Where the menu sits is the theme's to say: a
 * rail at the side (left or right) or a bar along the top, on wide screens.
 * On a phone it's always a bar naming the page, with the menu in a drawer.
 */
export function AppShell({ route, title, children }: { route: Route; title: string; children: ReactNode }): ReactElement {
  const board = usePoll(getBoard, 60_000).data;
  const [menuOpen, setMenuOpen] = useState(false);
  const phoneBar = useRef<HTMLElement>(null);
  useStickyOffset(phoneBar);
  const session = useSession();
  const { layout } = useTheme().theme;
  const password = session.status === 'authenticated' && route !== 'admin-password' ? session.adminPassword : 'set';
  const side = layout.shell === 'side';
  const right = side && layout.railSide === 'right';

  useEffect(() => {
    void refreshRouterMode();
    // the theme every device shows, and the custom themes, from the router
    void syncThemes();
  }, []);

  return (
    <div
      className={cn(
        'min-h-dvh',
        side && 'lg:grid',
        side && (right ? 'lg:grid-cols-[minmax(0,1fr)_var(--mf-nav-width)]' : 'lg:grid-cols-[var(--mf-nav-width)_minmax(0,1fr)]'),
      )}
    >
      {side ? (
        <aside
          className={cn('sticky top-0 hidden h-dvh border-sidebar-border lg:block', right ? 'order-last border-l' : 'border-r')}
        >
          <Sidebar active={route} board={board} />
        </aside>
      ) : (
        <div className="hidden lg:block">
          <TopBar active={route} board={board} />
        </div>
      )}

      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <header
          ref={phoneBar}
          data-slot="sidebar"
          className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground lg:hidden"
        >
          <DialogPrimitive.Trigger
            className="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-sidebar-accent"
            aria-label="Open menu"
          >
            <MenuIcon className="size-5" />
          </DialogPrimitive.Trigger>
          <Logo className="size-6 shrink-0" />
          <span className="min-w-0 truncate text-base font-semibold">{title}</span>
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-[mf-fade-in_var(--mf-duration-base)_var(--mf-ease-standard)] lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-80 max-w-[88vw] border-r border-sidebar-border shadow-lg outline-none data-[state=open]:animate-[mf-drawer-in_var(--mf-duration-slow)_var(--mf-ease-enter)] lg:hidden">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Pages of the router interface</DialogPrimitive.Description>
            <Sidebar
              active={route}
              board={board}
              onNavigate={() => {
                setMenuOpen(false);
              }}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main className="mx-auto w-full max-w-(--mf-content-max) px-4 pt-5 pb-24 sm:px-6 lg:px-(--mf-gutter) lg:pt-8">
        {password !== 'set' && <PasswordBar password={password} />}
        {children}
      </main>
    </div>
  );
}
