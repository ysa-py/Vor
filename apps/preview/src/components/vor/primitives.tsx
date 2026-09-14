'use client';

/**
 * VOR tactical UI primitives — built to the DESIGN.md spec:
 * hairline #2A3447 seams, 4px/8px radii, mono uppercase micro-labels,
 * tabular numerals, rectangular toggles (36x20, 2px radius), breathing dots,
 * glassy Level-3 overlays with 16px backdrop blur.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';

/* ------------------------------------------------------------------ */

export function Panel({
  children,
  className = '',
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: 'sec' | 'err' | 'prim';
}) {
  return (
    <div
      className={`rounded-lg bg-surf-low border border-seam ${glow === 'sec' ? 'glow-sec' : glow === 'err' ? 'glow-err' : glow === 'prim' ? 'glow-prim' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function Micro({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`label-xs uppercase text-faint ${className}`}>{children}</span>;
}

export function StatusDot({
  color = '#4edea3',
  breathe = true,
  size = 6,
  ping = false,
}: {
  color?: string;
  breathe?: boolean;
  size?: number;
  ping?: boolean;
}) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }} aria-hidden>
      {ping && (
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className={`relative inline-flex rounded-full ${breathe ? 'animate-breathe' : ''}`}
        style={{ backgroundColor: color, width: size, height: size }}
      />
    </span>
  );
}

export function Pill({
  children,
  color = 'text-prim',
  bg = 'bg-surf-high',
  className = '',
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  className?: string;
}) {
  return (
    <span
      className={`label-xs uppercase rounded-2px px-1.5 py-0.5 inline-flex items-center gap-1 ${bg} ${color} ${className}`}
    >
      {children}
    </span>
  );
}

/* Rectangular structural toggle — 36x20, 2px radius, NOT pill-shaped. */
export function TacticalToggle({
  checked,
  onChange,
  onColor = '#10b981',
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  onColor?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      dir="ltr"
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-2px p-0.5 flex items-center transition-colors shrink-0 cursor-pointer border border-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
      style={{ backgroundColor: checked ? onColor : '#2a3447' }}
    >
      <span
        className="w-4 h-4 rounded-2px shadow-md transition-transform"
        style={{
          backgroundColor: checked ? '#e6fbf3' : '#8c909f',
          transform: `translateX(${checked ? '16px' : '0'})`,
        }}
        data-flip={checked ? '1' : '0'}
      />
    </button>
  );
}

/* RTL-safe: the toggle button is dir="ltr" so the knob transform is stable in both layouts. */

export function CopyBtn({
  value,
  children,
  className = '',
}: {
  value: string;
  children?: ReactNode;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = useCallback(() => {
    const write = navigator.clipboard?.writeText(value);
    Promise.resolve(write)
      .catch(() => undefined)
      .finally(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      });
  }, [value]);
  return (
    <button
      type="button"
      onClick={copy}
      className={`h-8 px-2.5 bg-surf-high hover:bg-surf-bright text-prim label-xs rounded-4px flex items-center gap-1 shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${className}`}
    >
      {done ? <Check className="w-3.5 h-3.5 text-sec" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{children ?? 'COPY'}</span>
    </button>
  );
}

/* Sparkline — SVG polyline with gradient area fill. */
export function Sparkline({
  data,
  stroke = '#adc6ff',
  fill = 'rgba(173,198,255,0.28)',
  height = 34,
  max,
}: {
  data: number[];
  stroke?: string;
  fill?: string;
  height?: number;
  max?: number;
}) {
  const W = 120;
  const H = 30;
  const points = data.slice(-48);
  const vmax = max ?? Math.max(0.001, ...points) * 1.15;
  const path =
    points.length >= 2
      ? points
          .map((v, i) => {
            const x = (i / (points.length - 1)) * W;
            const y = H - (v / vmax) * H;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';
  const area = path ? `${path} L${W},${H} L0,${H} Z` : '';
  const lastY = points.length ? H - (points[points.length - 1] / vmax) * H : H;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height, width: '100%' }}
      aria-hidden
    >
      {area && <path d={area} fill={fill} />}
      {path && <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />}
      {path && <circle cx={W} cy={lastY} r={2.2} fill={stroke} />}
    </svg>
  );
}

/* Vertical bar oscilloscope (entropy / jitter probes). */
export function BarScope({ data, height = 64 }: { data: number[]; height?: number }) {
  const bars = data.slice(-20);
  while (bars.length < 20) bars.unshift(0);
  return (
    <div className="w-full bg-surf-lowest rounded p-1.5 flex items-end justify-between gap-0.5" style={{ height }} aria-hidden>
      {bars.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-2px transition-all duration-500"
          style={{
            height: `${Math.max(4, v * 100)}%`,
            backgroundColor: v > 0.75 ? '#ffb95f' : v > 0.45 ? '#4d8eff' : '#4edea3',
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

/* Level-3 glassy modal. */
export function Modal({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-[#0f141ce6] backdrop-blur-md p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto vor-scroll rounded-lg bg-surf-high border border-seam-strong p-4 sm:p-5 shadow-[0_16px_32px_-4px_rgba(0,0,0,0.6)] flex flex-col gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 end-3 text-muted hover:text-ink p-1 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

/* 38px tactical input. */
export function TacticalInput({
  value,
  onChange,
  placeholder,
  mono = true,
  type = 'text',
  ariaLabel,
  invalid = false,
  min,
  max,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
  ariaLabel?: string;
  invalid?: boolean;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      dir="ltr"
      className={`w-full h-[38px] px-3 bg-surf-lowest text-ink text-[13px] rounded-4px shadow-inner border transition-colors focus:outline-none focus:ring-1 focus:ring-prim-action placeholder:text-outline-var ${
        invalid ? 'border-crimson' : 'border-seam focus:border-prim-action'
      } ${mono ? 'mono tracking-wide' : ''} ${className}`}
    />
  );
}

export function GhostButton({
  children,
  onClick,
  className = '',
  ariaLabel,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`px-3 py-2 rounded-4px border border-seam text-muted hover:text-ink hover:border-seam-strong hover:bg-surf label-xs uppercase transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${className}`}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  color = 'primary',
  className = '',
  disabled,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  color?: 'primary' | 'sec' | 'danger';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}) {
  const palette =
    color === 'sec'
      ? 'bg-[#00a572] hover:bg-[#10b981] text-[#00311f]'
      : color === 'danger'
        ? 'bg-[#93000a] hover:bg-[#b3222c] text-[#ffdad6]'
        : 'bg-prim-deep hover:bg-prim-action text-[#f8fafc]';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`w-full py-3 rounded-lg label-md uppercase font-semibold tracking-wider flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prim-action disabled:opacity-50 disabled:cursor-not-allowed ${palette} ${className}`}
    >
      {children}
    </button>
  );
}

/** Live session clock (mm:ss.ms style, tabular numerals). Owns its 100ms interval. */
export function SessionClock({ start, running }: { start: number | null; running: boolean }) {
  const [, force] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (running && start) {
      ref.current = setInterval(() => force((n) => n + 1), 100);
    }
    return () => {
      if (ref.current) clearInterval(ref.current);
      ref.current = null;
    };
  }, [running, start]);
  if (!start || !running) return <span className="tnum">00:00:00.000</span>;
  const diff = Date.now() - start;
  const h = String(Math.floor(diff / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((diff % 60_000) / 1000)).padStart(2, '0');
  const ms = String(diff % 1000).padStart(3, '0');
  return (
    <span className="tnum" dir="ltr">
      {h}:{m}:{s}.{ms}
    </span>
  );
}
