/**
 * Signal-to-noise ratio, dB: how far a device's signal stands above the noise
 * the radio hears on its channel, the figure that sets how fast a link can go.
 * undefined when either isn't known: a noise of 0 or more is a driver that
 * doesn't measure it, and a signal at or under the noise has no SNR to speak of.
 */
export function snrOf(signal: number | null | undefined, noise: number | null | undefined): number | undefined {
  if (signal === null || signal === undefined || noise === null || noise === undefined) return undefined;
  if (!Number.isFinite(signal) || !Number.isFinite(noise) || noise >= 0 || signal <= noise) return undefined;
  return Math.round(signal - noise);
}
