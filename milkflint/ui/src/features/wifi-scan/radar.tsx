// The radar: this router in the middle, the networks it heard around it.
// The rim is a dial of channels, each band a sector of its own, so networks
// on the same channel line up and the ones on this router's channels fall in
// its shaded wedge. Closer to the middle is louder here. Each network is a
// dot on its main channel and an arc over every channel its air covers.
// Rust is only ever this router's own (its channels, and the networks on
// them); everything else, the sweep included, stays in ink. It moves only
// while a scan runs.
import { type ReactElement, useId } from 'react';
import { Logo } from '@/components/layout/sidebar';
import { cn } from '@/lib/utils';
import type { ScannedNetwork } from './api';
import {
  angleOf,
  arcPath,
  type BandId,
  bandChannels,
  channelMhz,
  coverLabel,
  coveredChannels,
  jitter,
  point,
  RADAR,
  radiusOf,
  ringSignals,
  type Sector,
  securityOf,
  signalWord,
  spanOf,
  wedgePath,
} from './spectrum';

/** What this router itself takes up on a band. */
export interface OwnChannel {
  band: BandId;
  span: [number, number];
  label: string;
}

export interface Blip {
  network: ScannedNetwork;
  /** On this router's channels. */
  shares: boolean;
}

const VIEW = 206;
/** One turn of the sweep; it only turns while a scan runs. */
const SWEEP_S = 2.4;
/** Channels numbered on narrow screens too (the rest only from sm up). */
const KEY_CHANNELS: Record<BandId, readonly number[]> = {
  '2g': [1, 6, 11],
  '5g': [36, 52, 64, 100, 116, 132, 149, 165],
  '6g': [1, 33, 65, 97, 129, 161, 193, 225],
};

function f(n: number): string {
  return n.toFixed(2);
}

/** The channels numbered around a band's part of the rim. */
function dialChannels(band: BandId): number[] {
  // 6 GHz has 59: every eighth is enough
  return band === '6g' ? [...KEY_CHANNELS['6g']] : bandChannels(band);
}

function SectorFrame({
  sector,
  labelPath,
  own,
  covered,
}: {
  sector: Sector;
  labelPath: string;
  /** This router's channels on the band. */
  own: ReadonlySet<number>;
  /** The channels the hovered or selected network covers, when it's on this band. */
  covered: ReadonlySet<number>;
}): ReactElement {
  const key = KEY_CHANNELS[sector.band];
  const channels = dialChannels(sector.band);
  const mid = (sector.start + sector.end) / 2;
  // bottom half: run the label's path the other way, so it isn't upside down
  const flipped = mid > 90 && mid < 270;
  const labelR = RADAR.outer + 26;
  const a = point(flipped ? sector.end : sector.start, labelR);
  const b = point(flipped ? sector.start : sector.end, labelR);
  const large = sector.end - sector.start > 180 ? 1 : 0;
  const d = `M ${f(a.x)} ${f(a.y)} A ${String(labelR)} ${String(labelR)} 0 ${String(large)} ${flipped ? 0 : 1} ${f(b.x)} ${f(b.y)}`;
  return (
    <g>
      <path d={wedgePath(RADAR.inner, RADAR.outer, sector.start, sector.end)} className="fill-foreground/[0.035]" />
      {bandChannels(sector.band).map((ch) => {
        const angle = angleOf(sector, channelMhz(sector.band, ch));
        const long = key.includes(ch);
        const p0 = point(angle, RADAR.outer);
        const p1 = point(angle, RADAR.outer + (long ? 4.5 : 2.5));
        return (
          <line
            key={ch}
            x1={f(p0.x)}
            y1={f(p0.y)}
            x2={f(p1.x)}
            y2={f(p1.y)}
            className={covered.has(ch) ? 'stroke-foreground' : 'stroke-foreground/30'}
            strokeWidth={covered.has(ch) ? 1.2 : 0.8}
          />
        );
      })}
      {channels.map((ch) => {
        const p = point(angleOf(sector, channelMhz(sector.band, ch)), RADAR.outer + 12);
        return (
          <text
            key={ch}
            x={f(p.x)}
            y={f(p.y)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={sector.band === '2g' ? 7.5 : 6.6}
            className={cn(
              'font-mono transition-colors',
              covered.has(ch) ? 'fill-foreground font-semibold' : own.has(ch) ? 'fill-primary font-medium' : 'fill-muted-foreground',
              !key.includes(ch) && !covered.has(ch) && 'max-sm:hidden',
            )}
          >
            {ch}
          </text>
        );
      })}
      <path id={labelPath} d={d} fill="none" />
      <text className="fill-muted-foreground font-medium" fontSize={8.5} letterSpacing={1.6} dominantBaseline={flipped ? 'hanging' : 'auto'}>
        <textPath href={`#${labelPath}`} startOffset="50%" textAnchor="middle">
          {sector.label.toUpperCase()}
        </textPath>
      </text>
    </g>
  );
}

export function Radar({
  sectors,
  blips,
  own,
  scanning,
  stale,
  focused,
  onFocus,
  onSelect,
  status,
}: {
  sectors: readonly Sector[];
  blips: readonly Blip[];
  own: readonly OwnChannel[];
  scanning: boolean;
  /** The networks are from a while ago: shown fainter. */
  stale: boolean;
  /** The network hovered or selected, here or in the list (by BSSID). */
  focused: string | undefined;
  onFocus: (bssid: string | undefined) => void;
  onSelect: (bssid: string) => void;
  /** Said under the router while there's nothing to show. */
  status: string | undefined;
}): ReactElement {
  const ids = useId();
  const placed = blips.flatMap((b) => {
    const sector = sectors.find((s) => s.band === b.network.band);
    if (sector === undefined) return [];
    const [lo, hi] = spanOf(b.network);
    // a little spread on the main channel, so neighbours there don't hide each other
    const spread = b.network.band === '2g' ? 2 : 7;
    const angle = angleOf(sector, b.network.mhz + jitter(b.network.bssid) * spread);
    return [{ ...b, angle, from: angleOf(sector, lo), to: angleOf(sector, hi), r: radiusOf(b.network.signal) }];
  });
  // the focused one last, so it's drawn on top
  placed.sort((a, b) => Number(a.network.bssid === focused) - Number(b.network.bssid === focused));

  const tip = placed.find((p) => p.network.bssid === focused);
  const tipAt = tip === undefined ? undefined : point(tip.angle, tip.r);
  const covered = new Set(tip === undefined ? [] : coveredChannels(tip.network));
  const ownChannels = (band: BandId): Set<number> => {
    const o = own.find((x) => x.band === band);
    return new Set(o === undefined ? [] : coveredChannels({ band, center: (o.span[0] + o.span[1]) / 2, width: o.span[1] - o.span[0] }));
  };

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
      <svg
        viewBox={`${String(-VIEW)} ${String(-VIEW)} ${String(2 * VIEW)} ${String(2 * VIEW)}`}
        className="absolute inset-0 size-full overflow-visible select-none"
        role="group"
        aria-label={`Radar of ${String(blips.length)} nearby networks: the closer to the middle, the stronger the signal here`}
        onPointerLeave={() => {
          onFocus(undefined);
        }}
      >
        <circle r={RADAR.outer} className="fill-card stroke-foreground/20" strokeWidth={0.8} />
        {sectors.map((s) => (
          <SectorFrame
            key={s.band}
            sector={s}
            labelPath={`${ids}band-${s.band}`}
            own={ownChannels(s.band)}
            covered={tip?.network.band === s.band ? covered : new Set()}
          />
        ))}

        {/* this router's own channels: a wedge, and its stretch of the rim */}
        {own.map((o) => {
          const sector = sectors.find((s) => s.band === o.band);
          if (sector === undefined) return null;
          const from = angleOf(sector, o.span[0]);
          const to = Math.max(angleOf(sector, o.span[1]), from + 1.5);
          const labelAt = point((from + to) / 2, RADAR.outer - 9);
          return (
            <g key={o.band}>
              <path d={wedgePath(RADAR.inner, RADAR.outer, from, to)} className="fill-primary/[0.07]" />
              <path d={arcPath(RADAR.outer, from, to)} fill="none" className="stroke-primary" strokeWidth={2.4} />
              <text
                x={f(labelAt.x)}
                y={f(labelAt.y)}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-primary font-semibold"
                fontSize={6.5}
                letterSpacing={1}
              >
                {o.label}
              </text>
            </g>
          );
        })}

        {/* rings: signal strength here */}
        {ringSignals.map((dbm) => (
          <circle key={dbm} r={f(radiusOf(dbm))} fill="none" className="stroke-foreground/10" strokeWidth={0.6} />
        ))}
        {ringSignals.map((dbm) => (
          <text
            key={dbm}
            x={0}
            y={f(-radiusOf(dbm))}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground stroke-card font-mono"
            fontSize={6.5}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {dbm}
          </text>
        ))}

        {/* the channels the focused network covers, on the rim */}
        {tip !== undefined && (
          <path
            d={arcPath(RADAR.outer + 1.6, tip.from, Math.max(tip.to, tip.from + 0.8))}
            fill="none"
            className="stroke-foreground"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        )}

        {/* sonar rings while it listens */}
        {scanning &&
          [0, 1, 2].map((i) => (
            <circle
              key={i}
              r={RADAR.outer}
              fill="none"
              className="radar-ripple stroke-foreground/40"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: `${String(i * 0.8)}s` }}
            />
          ))}

        {/* the networks; while it scans, restarted with the sweep, so each pings as it passes */}
        <g key={scanning ? 'scanning' : 'idle'}>
          {placed.map((p) => {
            const at = point(p.angle, p.r);
            const isFocused = p.network.bssid === focused;
            const dim = focused !== undefined && !isFocused;
            const hidden = p.network.ssid === null;
            const name = p.network.ssid ?? 'Hidden network';
            return (
              <g
                key={p.network.bssid}
                className={cn(
                  'cursor-pointer outline-none transition-opacity duration-200',
                  p.shares ? 'text-primary' : 'text-foreground/60',
                  dim ? 'opacity-25' : stale && !isFocused && 'opacity-45',
                )}
                role="button"
                tabIndex={0}
                aria-label={`${name}, channel ${String(p.network.channel)}, covers ${coverLabel(p.network)}, ${p.network.signal === null ? 'signal unknown' : `${String(p.network.signal)} dBm`}`}
                aria-pressed={isFocused}
                onPointerEnter={() => {
                  onFocus(p.network.bssid);
                }}
                onFocus={() => {
                  onFocus(p.network.bssid);
                }}
                onBlur={() => {
                  onFocus(undefined);
                }}
                onClick={() => {
                  onSelect(p.network.bssid);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(p.network.bssid);
                  }
                }}
              >
                <path
                  d={arcPath(p.r, p.from, Math.max(p.to, p.from + 0.8))}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={isFocused ? 0.75 : 0.22}
                  strokeWidth={isFocused ? 3.6 : 2.6}
                  strokeLinecap="round"
                />
                {scanning && (
                  <circle
                    cx={f(at.x)}
                    cy={f(at.y)}
                    r={3.6}
                    className="radar-ping"
                    fill="currentColor"
                    style={{ animationDuration: `${String(SWEEP_S)}s`, animationDelay: `${f((p.angle / 360) * SWEEP_S)}s` }}
                  />
                )}
                {isFocused && <circle cx={f(at.x)} cy={f(at.y)} r={8.5} fill="none" stroke="currentColor" strokeWidth={1} />}
                <circle
                  cx={f(at.x)}
                  cy={f(at.y)}
                  r={isFocused ? 5 : 3.6}
                  fill={hidden ? 'var(--card)' : 'currentColor'}
                  stroke="currentColor"
                  strokeWidth={hidden ? 1.4 : 0}
                />
                {/* an easier target than the dot */}
                <circle cx={f(at.x)} cy={f(at.y)} r={11} fill="transparent" />
              </g>
            );
          })}
        </g>

        {/* the router */}
        <circle r={RADAR.inner - 6} className={cn('fill-card', scanning ? 'stroke-foreground/50' : 'stroke-foreground/20')} strokeWidth={1} />
        <Logo x={-16} y={-17} width={32} height={32} />
        {status !== undefined && (
          <text y={RADAR.inner + 14} textAnchor="middle" className="fill-muted-foreground stroke-card" fontSize={9} strokeWidth={4} paintOrder="stroke">
            {status}
          </text>
        )}
      </svg>

      {/* while it scans: a beam of ink turning clockwise, fading behind */}
      {scanning && (
        <div
          aria-hidden="true"
          className="radar-sweep pointer-events-none absolute rounded-full"
          style={{
            inset: `${f(((VIEW - RADAR.outer) / (2 * VIEW)) * 100)}%`,
            animationDuration: `${String(SWEEP_S)}s`,
            background:
              'conic-gradient(from 0deg, transparent 0deg 290deg, color-mix(in srgb, var(--foreground) 3%, transparent) 305deg, color-mix(in srgb, var(--foreground) 13%, transparent) 359.5deg, transparent 360deg)',
          }}
        >
          <div className="absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-t from-transparent to-foreground/60" />
        </div>
      )}

      {tip !== undefined && tipAt !== undefined && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-60 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md"
          style={{ left: `${f(((tipAt.x + VIEW) / (2 * VIEW)) * 100)}%`, top: `${f(((tipAt.y + VIEW) / (2 * VIEW)) * 100)}%` }}
        >
          <div className="truncate font-medium">{tip.network.ssid ?? 'Hidden network'}</div>
          <div className="tabular opacity-80">
            Channel {tip.network.channel} · {tip.network.width} MHz · covers {coverLabel(tip.network)}
          </div>
          <div className="tabular opacity-80">
            {tip.network.signal === null ? 'Signal unknown' : `${String(tip.network.signal)} dBm, ${signalWord(tip.network.signal).toLowerCase()}`} ·{' '}
            {securityOf(tip.network).label}
          </div>
          {tip.shares && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              Overlaps your channels
            </div>
          )}
        </div>
      )}
    </div>
  );
}
