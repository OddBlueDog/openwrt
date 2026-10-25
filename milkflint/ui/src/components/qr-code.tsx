import { type ReactElement, useMemo } from 'react';
import { qrModules } from '@/lib/qr';

/** A QR code, black on white in either theme (cameras read that best), with its quiet zone. */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }): ReactElement | null {
  const modules = useMemo(() => qrModules(text), [text]);
  if (modules === undefined) return null;
  const size = modules.length + 8;
  let d = '';
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${String(x + 4)} ${String(y + 4)}h1v1h-1z`;
    });
  });
  return (
    <svg viewBox={`0 0 ${String(size)} ${String(size)}`} role="img" aria-label={label} className={className} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
