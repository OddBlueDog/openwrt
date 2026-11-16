// How the Network quality page writes a time: one decimal under 10 ms.
import { formatNumber } from '@/lib/format';

export const ms = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)} ms`;
