// Whether Smart Queue's download runs as multi-queue CAKE (cake_mq, sqm's
// use_mq): one CAKE per transmit queue, each on its own CPU with RSS, sharing
// the speed. The Smart Queue page writes use_mq with the speed, Performance
// Tuning when the steering changes; both decide it here.
//
// Each of those queues holds its packets to its own share of the speed, so a
// packet waits behind another for longer than in one CAKE, three times as
// long with three busy queues, and that wait grows as the line gets slower.
// One CPU runs one CAKE easily on a slower line, so Automatic is from
// 500 Mbit/s, where CAKE also starts taking GRO packets whole (./gso.ts).
// milkflint.cake.multi_queue "1" or "0" overrides it.

export const MULTI_QUEUE_KBIT = 500_000;

export type MultiQueue = 'auto' | 'on' | 'off';

/** milkflint.cake.multi_queue as a choice: anything but "1" or "0" is automatic */
export function multiQueueSetting(value: string | undefined): MultiQueue {
  return value === '1' ? 'on' : value === '0' ? 'off' : 'auto';
}

/** milkflint.cake.multi_queue for a choice; undefined: unset */
export function multiQueueValue(choice: MultiQueue): string | undefined {
  return choice === 'on' ? '1' : choice === 'off' ? '0' : undefined;
}

/** Whether the download uses multi-queue CAKE at this download speed (kbit/s). */
export function usesMultiQueue(downloadKbit: number, choice: MultiQueue): boolean {
  return choice === 'auto' ? downloadKbit >= MULTI_QUEUE_KBIT : choice === 'on';
}

/**
 * The choice to show for a queue: the setting, unless sqm's use_mq isn't what
 * it gives at this speed (set in LuCI, say), which then shows as it is.
 * useMq undefined: no queue yet.
 */
export function multiQueueOf(setting: string | undefined, useMq: boolean | undefined, downloadKbit: number): MultiQueue {
  const choice = multiQueueSetting(setting);
  if (useMq === undefined || usesMultiQueue(downloadKbit, choice) === useMq) return choice;
  return useMq ? 'on' : 'off';
}
