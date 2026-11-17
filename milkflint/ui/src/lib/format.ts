// Number formatting for the UI. Units follow what people expect from routers:
// bytes in binary (MiB shown as "MB"), link and traffic rates in decimal bits.

const oneDecimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const noDecimals = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** 1536 -> "1.5 KB" (binary steps, as `free` and LuCI show memory). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${(unit === 0 ? noDecimals : oneDecimal).format(value)} ${units[unit] ?? 'B'}`;
}

const BIT_UNITS = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'];

/** Which of BIT_UNITS a rate is said in: the largest it reaches one of. */
function bitUnit(bitsPerSecond: number): number {
  let unit = 0;
  for (let value = bitsPerSecond; value >= 1000 && unit < BIT_UNITS.length - 1; value /= 1000) unit++;
  return unit;
}

function bitFigure(bitsPerSecond: number, unit: number): string {
  const value = bitsPerSecond / 1000 ** unit;
  return (value >= 100 || unit === 0 ? noDecimals : oneDecimal).format(value);
}

/** Bits per second -> "12.3 Mbit/s". */
export function formatBitrate(bitsPerSecond: number): string {
  const unit = bitUnit(bitsPerSecond);
  return `${bitFigure(bitsPerSecond, unit)} ${BIT_UNITS[unit] ?? 'bit/s'}`;
}

/** A rate against its limit, in the limit's unit, said once: "312 of 825 Mbit/s" (where there's little room). */
export function formatBitrateOf(bitsPerSecond: number, limit: number): string {
  const unit = bitUnit(limit);
  return `${bitFigure(bitsPerSecond, unit)} of ${bitFigure(limit, unit)} ${BIT_UNITS[unit] ?? 'bit/s'}`;
}

/** 93784 -> "1d 2h 3m". */
export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

/**
 * A duration for a line that mustn't change length every minute: above a
 * day, days and hours ("3d 15h"); above an hour, hours and minutes.
 */
export function formatDurationShort(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function formatPercent(fraction: number): string {
  return `${noDecimals.format(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals }).format(value);
}
