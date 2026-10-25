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

/** Bits per second -> "12.3 Mbit/s". */
export function formatBitrate(bitsPerSecond: number): string {
  const units = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'];
  let value = bitsPerSecond;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${(value >= 100 || unit === 0 ? noDecimals : oneDecimal).format(value)} ${units[unit] ?? 'bit/s'}`;
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

export function formatPercent(fraction: number): string {
  return `${noDecimals.format(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals }).format(value);
}
