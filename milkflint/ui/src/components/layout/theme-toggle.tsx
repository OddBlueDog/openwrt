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
    <div role="radiogroup" aria-label="Colour theme" className={cn('flex rounded-md border bg-card p-0.5', className)}>
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
            'flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground',
            choice === value && 'bg-accent text-foreground',
          )}
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
