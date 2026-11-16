import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { setTheme, type ThemeChoice, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const options: readonly { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

export function ThemeToggle({ className }: { className?: string }): ReactElement {
  const { choice } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Light or dark"
      className={cn('grid grid-cols-3 gap-0.5 rounded-lg bg-sidebar-accent p-0.5', className)}
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          title={label}
          onClick={() => {
            setTheme(value);
          }}
          className={cn(
            'flex h-7 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground transition-colors duration-fast hover:text-sidebar-accent-foreground',
            choice === value && 'bg-sidebar text-sidebar-foreground shadow-xs',
          )}
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
