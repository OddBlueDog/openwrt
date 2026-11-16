// Download and upload as drawn arrows, with the word for screen readers, in
// place of ↓ and ↑ characters.
import { ArrowDownIcon, ArrowLeftRightIcon, ArrowRightIcon, ArrowUpIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

const icons = { down: ArrowDownIcon, up: ArrowUpIcon, to: ArrowRightIcon, between: ArrowLeftRightIcon } as const;
const words = { down: 'download', up: 'upload', to: 'to', between: 'and' } as const;

/** An arrow at text size, read out as its word. */
export function Dir({ d, className }: { d: keyof typeof icons; className?: string | undefined }): ReactElement {
  const Icon = icons[d];
  return (
    <>
      <Icon className={cn('inline size-3.5 shrink-0 align-[-0.125em] text-muted-foreground', className)} aria-hidden="true" />
      <span className="sr-only">{words[d]}</span>
    </>
  );
}

const chars: Record<string, keyof typeof icons> = { '↓': 'down', '↑': 'up', '→': 'to', '↔': 'between' };

/**
 * Text that carries arrow characters as data (a check's figure such as
 * "↓ 4 ms", a pair's phase "Mac → PC"), with each arrow drawn instead.
 */
export function Arrowed({ text }: { text: string }): ReactElement {
  const parts = text.split(/([↓↑→↔])/);
  return (
    <>
      {parts.map((p, i) => {
        const d = chars[p];
        return d === undefined ? p : <Dir key={i} d={d} />;
      })}
    </>
  );
}
