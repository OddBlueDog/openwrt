// Whether Smart Queue's download runs as multi-queue CAKE (cake_mq, sqm's
// use_mq): one CAKE per transmit queue, each on its own CPU (with RSS, or
// packet steering's RPS and a queue per CPU), sharing the speed. The Smart
// Queue page writes use_mq with the speed, Performance Tuning when the
// steering changes; both decide it here.
//
// Each of those queues holds its packets to its own share of the speed, so a
// packet waits behind another for longer than in one CAKE, three times as
// long with three busy queues, and the hosts' and DSCP tins' fairness is
// worked out per queue and shared out between them rather than exact. One
// CAKE also takes CPU from every CPU that hands it packets, under one lock.
// On an Ethernet line, GRO hands CAKE packets of up to 16-64 KB, and one CAKE
// keeps up with a gigabit line with CPU to spare: Automatic is from 1 Gbit/s
// there. On a PPPoE line Automatic stays from 500 Mbit/s, where it has been:
// its downloads all reach CPU 0 (RSS can't read PPPoE; GRO happens there too:
// OpenWrt's 650-net-pppoe-implement-GRO-support in the 6.12 kernel) before
// packet steering hands them on, which hasn't been compared with one CAKE yet.
// milkflint.cake.multi_queue "1" or "0" overrides it.

/** Automatic's threshold on an Ethernet line (DHCP, static, ...), kbit/s */
export const MULTI_QUEUE_ETH_KBIT = 1_000_000;
/** ... and on a PPPoE line */
export const MULTI_QUEUE_PPPOE_KBIT = 500_000;

/** The download speed (kbit/s) from which Automatic uses multi-queue CAKE on this kind of line */
export function multiQueueThresholdKbit(pppoe: boolean): number {
  return pppoe ? MULTI_QUEUE_PPPOE_KBIT : MULTI_QUEUE_ETH_KBIT;
}

export type MultiQueue = 'auto' | 'on' | 'off';

/** milkflint.cake.multi_queue as a choice: anything but "1" or "0" is automatic */
export function multiQueueSetting(value: string | undefined): MultiQueue {
  return value === '1' ? 'on' : value === '0' ? 'off' : 'auto';
}

/** milkflint.cake.multi_queue for a choice; undefined: unset */
export function multiQueueValue(choice: MultiQueue): string | undefined {
  return choice === 'on' ? '1' : choice === 'off' ? '0' : undefined;
}

/** Whether the download uses multi-queue CAKE at this download speed (kbit/s), on a PPPoE line or not. */
export function usesMultiQueue(downloadKbit: number, choice: MultiQueue, pppoe: boolean): boolean {
  return choice === 'auto' ? downloadKbit >= multiQueueThresholdKbit(pppoe) : choice === 'on';
}

/**
 * The choice to show for a queue: the setting, unless sqm's use_mq isn't what
 * it gives at this speed (set in LuCI, say), which then shows as it is.
 * useMq undefined: no queue yet.
 */
export function multiQueueOf(
  setting: string | undefined,
  useMq: boolean | undefined,
  downloadKbit: number,
  pppoe: boolean,
): MultiQueue {
  const choice = multiQueueSetting(setting);
  if (useMq === undefined || usesMultiQueue(downloadKbit, choice, pppoe) === useMq) return choice;
  return useMq ? 'on' : 'off';
}
