// What a new guest network is for: visitors, or smart-home devices. The
// choice sets what it starts with; after that, everything is a setting.
import { HousePlugIcon, type LucideIcon, UsersIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import type { Kind } from './model';

const choices: { kind: Kind; icon: LucideIcon; title: string; text: string }[] = [
  {
    kind: 'visitors',
    icon: UsersIcon,
    title: 'For visitors',
    text: 'Their phones and laptops, on both bands, kept apart from each other.',
  },
  {
    kind: 'devices',
    icon: HousePlugIcon,
    title: 'For smart-home devices',
    text: 'Plugs, bulbs, cameras and speakers: 2.4 GHz and WPA2, which most of them need, away from your computers.',
  },
];

/**
 * The two kinds as cards. With `value` they're a choice that stays shown
 * (the one picked in the selected style), for a network not saved yet;
 * without, a pick that adds one.
 */
export function KindChoice({ value, onPick, label }: { value?: Kind; onPick: (k: Kind) => void; label: string }): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={label}>
      {choices.map((c) => {
        const selected = value === c.kind;
        return (
          <button
            key={c.kind}
            type="button"
            {...(value === undefined ? {} : { 'aria-pressed': selected })}
            onClick={() => {
              onPick(c.kind);
            }}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors duration-fast',
              selected ? 'border-primary bg-primary-subtle' : 'bg-card hover:border-input hover:bg-accent',
            )}
          >
            <c.icon className={cn('mt-0.5 size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
            <span className="flex flex-col gap-1">
              <span className={cn('text-sm font-medium', selected && 'text-primary-subtle-foreground')}>{c.title}</span>
              <span className="text-xs text-muted-foreground">{c.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
