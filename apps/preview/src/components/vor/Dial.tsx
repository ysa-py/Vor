'use client';

/**
 * VOR actuation dial — concentric ring architecture (224px outer) per DESIGN.md:
 * 1.5px segmented telemetry tracks, rotating crypto-state indicators, and the
 * primary tactile core (90ms compression to 97% on actuation).
 */
import type { ReactNode } from 'react';

export type DialMode = 'armed' | 'connecting' | 'disconnected' | 'error';

const RING_COLOR: Record<DialMode, string> = {
  armed: '#4edea3',
  connecting: '#ffb95f',
  disconnected: '#4b5563',
  error: '#ef4444',
};

export function Dial({
  mode,
  progress = 0.25,
  onClick,
  icon,
  caption,
  disabled = false,
  ariaLabel,
}: {
  mode: DialMode;
  progress?: number;
  onClick?: () => void;
  icon: ReactNode;
  caption: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const c = RING_COLOR[mode];
  const C = 2 * Math.PI * 94;
  const C2 = 2 * Math.PI * 88;
  const C3 = 2 * Math.PI * 82;
  return (
    <div className="relative flex items-center justify-center my-2" style={{ width: 224, height: 224 }}>
      {/* Ambient holographic glows */}
      <div
        className="absolute -top-12 -left-12 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-60"
        style={{ backgroundColor: `${c}1a` }}
      />
      <div className="absolute -bottom-12 -right-12 w-44 h-44 rounded-full blur-3xl pointer-events-none bg-prim/10" />

      {/* Rotating telemetry rings */}
      <svg
        viewBox="0 0 200 200"
        className="w-56 h-56 animate-spin-slow pointer-events-none absolute"
        style={mode === 'connecting' ? { animationDuration: '6s' } : undefined}
        aria-hidden
      >
        <circle cx="100" cy="100" fill="none" r="94" stroke="#252a33" strokeDasharray="4 6" strokeWidth="2" />
        <circle
          cx="100"
          cy="100"
          fill="none"
          opacity="0.85"
          r="94"
          stroke={c}
          strokeWidth="1.5"
          strokeDasharray={`${C * progress} ${C}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 700ms ease, stroke 400ms ease' }}
        />
        <circle cx="100" cy="100" fill="none" opacity="0.6" r="88" stroke={c} strokeDasharray="40 180" strokeWidth="2" />
        <circle cx="100" cy="100" fill="none" opacity="0.55" r="82" stroke="#adc6ff" strokeDasharray="15 70" strokeWidth="1.5" />
      </svg>

      {/* Inner pulsing orbit */}
      <div
        className="absolute inset-6 rounded-full animate-pulse pointer-events-none"
        style={{ backgroundColor: `${c}0d` }}
      />

      {/* Core master button */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className="absolute w-36 h-36 rounded-full bg-surf-high flex flex-col items-center justify-center shadow-xl active:scale-[0.97] transition-all duration-[90ms] group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prim-action disabled:opacity-60"
      >
        <div className="w-28 h-28 rounded-full bg-surf-lowest flex flex-col items-center justify-center relative shadow-inner border border-seam">
          <span className="transition-transform duration-300 group-hover:scale-110" style={{ color: c }}>
            {icon}
          </span>
          <span
            className="label-xs tracking-widest font-bold mt-1.5 uppercase"
            style={{ color: c }}
          >
            {caption}
          </span>
        </div>
      </button>
    </div>
  );
}
