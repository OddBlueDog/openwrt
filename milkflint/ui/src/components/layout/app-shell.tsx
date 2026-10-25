import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MenuIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { usePoll } from '@/hooks/use-poll';
import { getBoard } from '@/lib/api/system';
import type { Route } from '@/lib/router';
import { useSession } from '@/lib/session';
import { Logo, Sidebar } from './sidebar';

export function AppShell({ route, children }: { route: Route; children: ReactNode }): ReactElement {
  const board = usePoll(getBoard, 60_000).data;
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession();
  const password = session.status === 'authenticated' && route !== 'admin-password' ? session.adminPassword : 'set';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r lg:block">
        <Sidebar active={route} board={board} />
      </aside>

      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <DialogPrimitive.Trigger className="-ml-1 rounded-md p-1.5 hover:bg-accent" aria-label="Open menu">
            <MenuIcon className="size-5" />
          </DialogPrimitive.Trigger>
          <Logo className="size-6" />
          <span className="text-sm font-semibold">{board?.hostname ?? 'Router'}</span>
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r shadow-xl outline-none lg:hidden">
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

      <main className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        {password !== 'set' && (
          <Alert variant="warning" className="mb-6">
            <TriangleAlertIcon />
            <AlertTitle>{password === 'none' ? 'No admin password is set' : 'The admin password is still the default'}</AlertTitle>
            <AlertDescription>
              <span>
                {password === 'none'
                  ? 'Anyone on your network can open these pages, LuCI and SSH and change your settings.'
                  : 'Anyone on your network who knows it can change your settings.'}{' '}
                <a href="#/admin-password" className="font-medium text-foreground underline underline-offset-2">
                  {password === 'none' ? 'Set one' : 'Change it'}
                </a>
              </span>
            </AlertDescription>
          </Alert>
        )}
        {children}
      </main>
    </div>
  );
}
