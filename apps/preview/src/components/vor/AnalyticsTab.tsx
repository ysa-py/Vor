'use client';

/**
 * View B-2 — Analytics: live metric cards, rolling vector-latency chart,
 * cryptographic hop topology and stack/congestion telemetry.
 */
import { Gauge, ChartLine, Network, Cpu, ArrowUpRight, Waves } from 'lucide-react';
import { useVor, t } from '@/lib/vor/store';
import { Micro, Panel, Pill, Sparkline, StatusDot } from './primitives';

function metricGrade(v: number): string {
  if (v < 60) return 'text-sec';
  if (v < 150) return 'text-tert';
  return 'text-err';
}

export function AnalyticsTab() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const telemetry = useVor((s) => s.telemetry);
  const series = useVor((s) => s.series);
  const settings = useVor((s) => s.settings);
  const transport = useVor((s) => s.transport);
  const selected = useVor((s) => s.selected);
  const connected = useVor((s) => s.tunnel === 'connected');

  const congestionLabel = settings.congestion === 'bbr' ? 'TCP BBRv3' : settings.congestion === 'cubic' ? 'TCP CUBIC' : 'Westwood+';

  return (
    <div className="flex flex-col gap-3.5">
      {/* stream status banner */}
      <div className="flex items-center justify-between bg-surf-low border border-seam rounded-lg px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <StatusDot color={connected ? '#4edea3' : '#4b5563'} ping={connected} />
          <div className="flex flex-col truncate">
            <span className={`label-xs uppercase tracking-wider ${connected ? 'text-sec' : 'text-muted'}`}>
              {T('streamSynced')}
            </span>
            <span className="label-xs text-faint truncate" dir="ltr">
              TUNNEL_ID: VOR-{transport.toUpperCase().slice(0, 6)}-BER-ZRH-8821
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-surf-high px-2 py-1 rounded shrink-0" dir="ltr">
          <Waves className="w-3.5 h-3.5 text-sec" aria-hidden />
          <span className="label-xs text-sec tracking-tight">{T('tickHz')}</span>
        </div>
      </div>

      {/* metric grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <Panel className="p-3">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('latency')}</Micro>
            <span className="label-xs text-sec bg-sec/10 px-1.5 py-0.5 rounded-2px tnum" dir="ltr">
              ±{telemetry.jitter.toFixed(1)}ms
            </span>
          </div>
          <div className="flex items-baseline gap-1 my-1" dir="ltr">
            <span className={`text-[22px] leading-tight font-bold tnum ${metricGrade(telemetry.latency)}`}>
              {telemetry.latency.toFixed(1)}
            </span>
            <span className="label-xs text-faint">ms</span>
          </div>
          <Sparkline data={series.latency} stroke="#adc6ff" fill="rgba(173,198,255,0.25)" height={30} />
        </Panel>
        <Panel className="p-3">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('jitter')}</Micro>
            <Gauge className="w-3.5 h-3.5 text-prim" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1 my-1" dir="ltr">
            <span className="text-[22px] leading-tight font-bold text-ink tnum">{telemetry.jitter.toFixed(1)}</span>
            <span className="label-xs text-faint">ms</span>
          </div>
          <div className="w-full bg-surf-highest h-1.5 rounded-full overflow-hidden my-1.5">
            <div className="bg-prim h-full rounded-full transition-all" style={{ width: `${Math.min(100, (telemetry.jitter / 8) * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between label-xs text-faint">
            <span className="tnum" dir="ltr">PEAK {Math.max(0, ...series.jitter).toFixed(1)}ms</span>
            <span className="text-sec">{telemetry.jitter < 3 ? T('nominal') : 'ELEVATED'}</span>
          </div>
        </Panel>
        <Panel className="p-3">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('packetLoss')}</Micro>
            <Pill color="text-sec" bg="bg-sec/10">{T('fecOn')}</Pill>
          </div>
          <div className="flex items-baseline gap-1 my-1" dir="ltr">
            <span className={`text-[22px] leading-tight font-bold tnum ${telemetry.loss > 2 ? 'text-err' : 'text-sec'}`}>
              {telemetry.loss.toFixed(2)}
            </span>
            <span className="label-xs text-sec">%</span>
          </div>
          <Sparkline data={series.loss} stroke="#4edea3" fill="rgba(78,222,163,0.2)" height={26} max={Math.max(2, ...series.loss)} />
        </Panel>
        <Panel className="p-3">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('throughput')}</Micro>
            <ArrowUpRight className="w-3.5 h-3.5 text-sec" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1 my-1" dir="ltr">
            <span className="text-[22px] leading-tight font-bold text-ink tnum">{telemetry.down.toFixed(1)}</span>
            <span className="label-xs text-faint">Mbps</span>
          </div>
          <div className="w-full bg-surf-highest h-1.5 rounded-full overflow-hidden my-1.5">
            <div className="bg-sec h-full rounded-full transition-all" style={{ width: `${Math.min(100, (telemetry.down / 160) * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between label-xs text-faint">
            <span className="tnum" dir="ltr">{Math.round((telemetry.down / 160) * 100)}% PIPELINE</span>
            <span className="text-tert">BURST</span>
          </div>
        </Panel>
      </div>

      {/* vector chart */}
      <Panel className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChartLine className="w-4 h-4 text-prim" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('vectorChart')}</span>
          </div>
          <Pill color="text-sec" bg="bg-sec/10">ROLLING 48s</Pill>
        </div>
        <div className="relative w-full h-40 bg-surf-lowest rounded-lg p-2.5 border border-seam overflow-hidden">
          <div className="absolute inset-0 flex flex-col justify-between p-3 opacity-10 pointer-events-none" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-full h-px bg-ink" />
            ))}
          </div>
          <div className="relative w-full h-24">
            <svg viewBox="0 0 320 80" preserveAspectRatio="none" className="w-full h-full" aria-hidden>
              <defs>
                <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#4d8eff" stopOpacity="0.45" />
                  <stop offset="70%" stopColor="#4d8eff" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#4d8eff" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="strokeGradient" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#4edea3" />
                  <stop offset="50%" stopColor="#adc6ff" />
                  <stop offset="100%" stopColor="#4d8eff" />
                </linearGradient>
              </defs>
              {(() => {
                const pts = series.latency.slice(-48);
                if (pts.length < 2) return null;
                const vmax = Math.max(20, ...pts) * 1.15;
                const line = pts
                  .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * 320).toFixed(1)},${(80 - (v / vmax) * 76).toFixed(1)}`)
                  .join(' ');
                return (
                  <>
                    <path d={`${line} L320,80 L0,80 Z`} fill="url(#areaGradient)" />
                    <path d={line} fill="none" stroke="url(#strokeGradient)" strokeWidth="2" strokeLinecap="round" />
                    <circle
                      cx={((pts.length - 1) / Math.max(1, pts.length - 1)) * 320}
                      cy={80 - (pts[pts.length - 1] / vmax) * 76}
                      r="3"
                      fill="#4edea3"
                    />
                  </>
                );
              })()}
            </svg>
          </div>
          <div className="flex items-center justify-between label-xs text-faint relative z-10" dir="ltr">
            <span>-48 S</span>
            <span className="text-prim font-bold tnum">
              CURRENT: {telemetry.latency.toFixed(1)}ms (TX: {(telemetry.up / 8).toFixed(1)}MB/s)
            </span>
            <span>NOW</span>
          </div>
        </div>
      </Panel>

      {/* hop topology */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-sec" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('hopTopology')}</span>
          </div>
          <Pill color="text-sec" bg="bg-sec/10">3 HOPS ACTIVE</Pill>
        </div>
        {[
          { name: 'CLIENT NODE', badge: 'BERLIN', sub: 'LOCAL TAP 10.240.0.2 • MTU ' + settings.mtu, ms: '0.4 ms', extra: 'HANDSHAKE OK', color: '#adc6ff' },
          { name: 'RELAY ALPHA', badge: selected ? selected.endpoint_id.toUpperCase() : 'FRA-IX 04', sub: 'POLY1305 AUTH MAC • CIPHER-L1', ms: '7.8 ms', extra: 'LOAD: 31%', color: '#4edea3' },
          { name: 'RELAY BETA', badge: 'ZURICH-CH', sub: 'CHACHA20 ENCLAVE • ZERO-LOG RAM', ms: '14.1 ms', extra: 'AIR-GAPPED', color: '#ffb95f' },
        ].map((hop, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-surf-lowest border border-seam p-2.5 rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center w-8 h-8 rounded bg-surf-high shrink-0" style={{ color: hop.color }}>
                  <StatusDot color={hop.color} size={7} />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="label-sm text-ink font-semibold truncate">{hop.name}</span>
                    <span className="label-xs px-1 rounded-2px shrink-0" style={{ color: hop.color, backgroundColor: `${hop.color}26` }} dir="ltr">
                      {hop.badge}
                    </span>
                  </div>
                  <span className="label-xs text-faint truncate" dir="ltr">{hop.sub}</span>
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="label-xs text-sec font-bold tnum" dir="ltr">{hop.ms}</span>
                <span className="label-xs text-faint" dir="ltr">{hop.extra}</span>
              </div>
            </div>
            {i < 2 && (
              <div className="flex items-center justify-between px-4">
                <span className="label-xs text-faint flex items-center gap-1.5" dir="ltr">
                  <span className="text-sec">🔒</span> X25519 ECDH AUTHENTICATED
                </span>
                <span className="label-xs text-prim tnum" dir="ltr">LOSS {telemetry.loss.toFixed(1)}%</span>
              </div>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between bg-surf-high p-2.5 rounded-lg">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded bg-prim-deep text-[#f8fafc] shrink-0">
              <Network className="w-4 h-4" aria-hidden />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="label-sm text-ink font-bold truncate">TARGET ENDPOINT</span>
              <span className="label-xs text-faint truncate">SECURE ZERO-TRUST GATEWAY</span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="label-xs text-prim font-bold tnum" dir="ltr">{telemetry.latency.toFixed(1)} ms TOTAL</span>
            <span className="label-xs text-sec">{connected ? 'EGRESS READY' : 'STANDBY'}</span>
          </div>
        </div>
      </Panel>

      {/* stack telemetry */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-prim" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('stackTelemetry')}</span>
          </div>
          <span className="label-xs text-faint" dir="ltr">KERNEL 6.6-RT</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surf-lowest border border-seam p-2.5 rounded-lg flex flex-col justify-between">
            <Micro>{T('congestionAlgo')}</Micro>
            <div className="flex items-center justify-between mt-1">
              <span className="label-sm font-bold text-ink" dir="ltr">{congestionLabel}</span>
              <span className="label-xs text-sec bg-sec/10 px-1 py-0.5 rounded-2px">OPTIMAL</span>
            </div>
            <span className="label-xs text-faint mt-1">Bw-Delay Product Locked</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2.5 rounded-lg flex flex-col justify-between">
            <Micro>{T('bufferbloat')}</Micro>
            <div className="flex items-center justify-between mt-1">
              <span className="label-sm font-bold text-sec" dir="ltr">GRADE A+</span>
              <span className="label-xs text-sec bg-sec/10 px-1 py-0.5 rounded-2px" dir="ltr">&lt;4ms LOAD</span>
            </div>
            <span className="label-xs text-faint mt-1">FQ-CoDel Active</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2.5 rounded-lg flex flex-col justify-between">
            <Micro>{T('mtuClamp')}</Micro>
            <div className="flex items-center justify-between mt-1">
              <span className="label-sm font-bold text-ink tnum" dir="ltr">{settings.mtu} BYTES</span>
              <span className="label-xs text-prim">OPTIMIZED</span>
            </div>
            <span className="label-xs text-faint mt-1 tnum" dir="ltr">MSS: {settings.mtu - 40} • DF Bit Set</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2.5 rounded-lg flex flex-col justify-between">
            <Micro>{T('keepalive')}</Micro>
            <div className="flex items-center justify-between mt-1">
              <span className="label-sm font-bold text-ink" dir="ltr">25 SECONDS</span>
              <span className="label-xs text-sec">AUTO</span>
            </div>
            <span className="label-xs text-faint mt-1">Zero Session Dropouts</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
