// A member's view of the router's clock, NTP-style: each sync asks the
// router for its monotonic time and notes when the request left and the
// answer came back (performance.now()). The answer was made somewhere in
// between, so the sample with the shortest round trip pins the offset
// best, to within half its round trip. A run's schedule is in router time;
// every member turns it into its own with this.

export interface ClockSample {
  /** performance.now() when the request left and when its answer came back, ms */
  sent: number;
  received: number;
  /** the router's clock in its answer, ms */
  router: number;
}

export interface ClockEstimate {
  /** router time = local time + offset, ms */
  offset: number;
  /** how far that may be off: half the sample's round trip, ms */
  uncertainty: number;
  /** when the sample it comes from was taken, local ms */
  at: number;
}

/** The estimate from the samples' shortest round trip (the latest of equals); undefined without samples. */
export function estimate(samples: readonly ClockSample[]): ClockEstimate | undefined {
  let best: ClockSample | undefined;
  for (const s of samples) {
    if (s.received < s.sent) continue;
    if (best === undefined || s.received - s.sent <= best.received - best.sent) best = s;
  }
  if (best === undefined) return undefined;
  const rtt = best.received - best.sent;
  return { offset: best.router - (best.sent + rtt / 2), uncertainty: rtt / 2, at: best.received };
}

/** Samples a clock keeps: older ones drift away from the truth (the two clocks don't tick at quite the same rate). */
export const KEEP = 16;

export class Clock {
  private samples: ClockSample[] = [];
  private current: ClockEstimate | undefined;

  add(sample: ClockSample): void {
    this.samples.push(sample);
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
    this.current = estimate(this.samples);
  }

  get estimate(): ClockEstimate | undefined {
    return this.current;
  }

  /** The router's time for a local time (performance.now() by default); undefined before any sync. */
  router(local: number = performance.now()): number | undefined {
    return this.current === undefined ? undefined : local + this.current.offset;
  }

  /** The local time (performance.now() scale) of a router time. */
  local(router: number): number | undefined {
    return this.current === undefined ? undefined : router - this.current.offset;
  }
}
