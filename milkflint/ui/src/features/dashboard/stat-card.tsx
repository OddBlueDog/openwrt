import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HISTORY } from './use-dashboard';

export function StatCard({
  icon: Icon,
  title,
  value,
  detail,
  badge,
  spark,
  sparkMax,
  sparkColor,
  sparkFormat,
  sparkTimes,
  children,
}: {
  icon: LucideIcon;
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
  spark?: readonly (number | undefined)[];
  sparkMax?: number;
  sparkColor?: string;
  /** A value when hovering the sparkline (off without it). */
  sparkFormat?: (value: number) => string;
  /** Each spark value's time, epoch seconds. */
  sparkTimes?: readonly number[];
  children?: ReactNode;
}): ReactElement {
  return (
    <Card className="gap-3 overflow-hidden pb-0">
      <CardHeader className="items-center">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <CardTitle className="font-medium text-muted-foreground">{title}</CardTitle>
        {badge !== undefined && <CardAction>{badge}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="text-3xl font-semibold tracking-tight tabular">{value}</div>
        {detail !== undefined && <div className="text-xs text-muted-foreground tabular">{detail}</div>}
        {children}
      </CardContent>
      {spark === undefined ? (
        <div className="h-5" />
      ) : (
        <Sparkline
          values={spark}
          max={sparkMax ?? 1}
          slots={HISTORY}
          color={sparkColor}
          className="-mt-1 h-14"
          label={title}
          format={sparkFormat}
          timeOf={sparkTimes === undefined ? undefined : (slot) => sparkTimes[slot - (HISTORY - sparkTimes.length)]}
        />
      )}
    </Card>
  );
}
