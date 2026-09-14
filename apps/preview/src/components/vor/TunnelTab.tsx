'use client';

/**
 * View B-1 — Tunnel dashboard: concentric dial, live telemetry strip,
 * cryptographic profile panel, security subsystem toggles, endpoint
 * explainability and the blackout banner.
 */
import { Lock, LockOpen, TriangleAlert, Gauge, ChartPie, ArrowDown, ArrowUp, ShieldCheck, LoaderCircle } from 'lucide-react';
import { useVor, t } from '@/lib/vor/store';
import { Dial, type DialMode } from './Dial';
import { Micro, Panel, Pill, Sparkline, StatusDot, TacticalToggle } from './primitives';
import { SessionClock } from './primitives';
import { TRANSPORT_LABELS } from '@/lib/vor/tunnel';
import { useState } from 'react';
import { useEffect } from 'react';

const STATE_KEY: Record<string, string> = {
  idle: 'stateIdle',
  preparing: 'statePreparing',
  checking_network: 'stateChecking',
  selecting_transport: 'stateSelecting',
  connecting: 'stateConnecting',
  handshake: 'stateHandshake',
  connected: 'tunnelEstablished',
  reconnecting: 'stateReconnecting',
  switching_transport: 'stateSwitching',
  diagnosing: 'stateDiagnosing',
  license_required: 'stateLicenseRequired',
  license_expired: 'stateLicenseExpired',
  config_error: 'stateConfigError',
};

export function TunnelTab() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const tunnel = useVor((s) => s.tunnel);
  const attempt = useVor((s) => s.attempt);
  const transport = useVor((s) => s.transport);
  const selected = useVor((s) => s.selected);
  const telemetry = useVor((s) => s.telemetry);
  const series = useVor((s) => s.series);
  const sessionStart = useVor((s) => s.sessionStart);
  const transferredMB = useVor((s) => s.transferredMB);
  const scenario = useVor((s) => s.scenario);
  const settings = useVor((s) => s.settings);
  const connect = useVor((s) => s.connect);
  const disconnect = useVor((s) => s.disconnect);
  const logEvent = useVor((s) => s.logEvent);

  const [subsystems, setSubsystems] = useState({ multiHop: true, dnsGuard: true, stealth: true });
  const connected = tunnel === 'connected';
  const busyStates = ['preparing', 'checking_network', 'selecting_transport', 'connecting', 'handshake', 'reconnecting', 'switching_transport', 'diagnosing'];
  const busy = busyStates.includes(tunnel);

  const mode: DialMode = connected
    ? 'armed'
    : tunnel === 'config_error' || tunnel === 'license_required' || tunnel === 'license_expired'
      ? 'error'
      : busy
        ? 'connecting'
        : 'disconnected';

  const dialCaption = connected ? 'ARMED' : busy ? 'LINKING' : tunnel === 'idle' ? 'DISARMED' : 'FAULT';
  const progress = busy ? 0.15 + (attempt / 5) * 0.7 : connected ? 0.92 : 0.08;

  const onDial = () => {
    if (connected || busy) {
      disconnect();
    } else {
      void connect();
    }
  };

  // Auto-connect on launch (settings) — fires once per session when idle.
  useEffect(() => {
    if (settings.autoConnect && tunnel === 'idle') {
      logEvent('controller', 'info', 'auto-connect policy engaged (settings.auto_connect)');
      void connect();
    }
  }, []);

  const stateLabel = T(STATE_KEY[tunnel] ?? 'stateIdle');

  return (
    <div className="flex flex-col gap-3.5">
      {/* Identity & session micro-bar */}
      <div className="flex items-center justify-between bg-surf-low border border-seam px-4 py-2.5 rounded-lg">
        <div className="flex items-center gap-2.5 min-w-0">
          <StatusDot color={connected ? '#4edea3' : '#4b5563'} ping={connected} />
          <div className="flex flex-col min-w-0">
            <Micro>{T('enclaveNode')}</Micro>
            <span className="label-sm text-sec tracking-wider font-semibold truncate" dir="ltr">
              {selected ? selected.endpoint_id.toUpperCase() : 'FRA-04'} · {TRANSPORT_LABELS[transport]}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-surf-high px-2.5 py-1 rounded shrink-0" dir="ltr">
          <Gauge className="w-3.5 h-3.5 text-sec" aria-hidden />
          <span className="label-xs text-ink font-semibold tnum">{telemetry.latency.toFixed(0)} ms</span>
        </div>
      </div>

      {/* Blackout banner */}
      {scenario === 'blackout' && (
        <div className="flex items-start gap-2 bg-tert/10 border border-tert/50 text-tert rounded-lg px-3.5 py-2.5">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <p className="text-xs leading-5">{T('blackoutBanner')}</p>
        </div>
      )}

      {/* Dial card */}
      <Panel className="relative overflow-hidden p-4 flex flex-col items-center" glow={connected ? 'sec' : undefined}>
        <Dial
          mode={mode}
          progress={progress}
          onClick={onDial}
          disabled={tunnel === 'license_required' || tunnel === 'license_expired'}
          ariaLabel={connected ? T('disconnect') : T('connect')}
          icon={
            connected ? (
              <Lock className="w-10 h-10" aria-hidden />
            ) : busy ? (
              <LoaderCircle className="w-10 h-10 animate-spin" aria-hidden />
            ) : (
              <LockOpen className="w-10 h-10" aria-hidden />
            )
          }
          caption={dialCaption}
        />
        <div className="flex flex-col items-center gap-1.5 mt-1">
          <div
            className={`flex items-center gap-2 px-4 py-1 rounded-full ${connected ? 'bg-sec/10' : busy ? 'bg-tert/10' : 'bg-surf-high'}`}
          >
            <StatusDot color={connected ? '#4edea3' : busy ? '#ffb95f' : '#4b5563'} />
            <span
              className={`label-md font-semibold uppercase tracking-wider ${connected ? 'text-sec' : busy ? 'text-tert' : 'text-muted'}`}
            >
              {stateLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 text-ink-var label-md">
            <span className="tnum text-ink" dir="ltr">
              <SessionClock start={sessionStart} running={connected} />
            </span>
            {busy && (
              <span className="label-xs text-tert uppercase tnum">
                {T('attemptN')} {attempt + 1}/5
              </span>
            )}
          </div>
        </div>
        {/* Primary connect button under the dial */}
        <button
          type="button"
          onClick={onDial}
          disabled={tunnel === 'license_required' || tunnel === 'license_expired'}
          className={`mt-3 w-full max-w-xs py-2.5 rounded-lg label-sm uppercase font-bold tracking-widest transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prim-action ${
            connected
              ? 'bg-crimson/15 text-err border border-crimson/50 hover:bg-crimson/25'
              : busy
                ? 'bg-tert/15 text-tert border border-tert/50'
                : 'bg-prim-deep hover:bg-prim-action text-[#f8fafc] shadow-md'
          }`}
        >
          {connected || busy ? T('disconnect') : T('connect')}
        </button>
      </Panel>

      {/* Telemetry strip */}
      <div className="grid grid-cols-3 gap-2">
        <Panel className="p-2.5">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('downlink')}</Micro>
            <ArrowDown className="w-3.5 h-3.5 text-sec" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1 mt-1" dir="ltr">
            <span className="text-xl font-bold text-ink tnum">{telemetry.down.toFixed(1)}</span>
            <span className="label-xs text-faint">Mbps</span>
          </div>
          <Sparkline data={series.down} stroke="#4edea3" fill="rgba(78,222,163,0.25)" height={22} />
        </Panel>
        <Panel className="p-2.5">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('uplink')}</Micro>
            <ArrowUp className="w-3.5 h-3.5 text-prim" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1 mt-1" dir="ltr">
            <span className="text-xl font-bold text-ink tnum">{telemetry.up.toFixed(1)}</span>
            <span className="label-xs text-faint">Mbps</span>
          </div>
          <Sparkline data={series.up} stroke="#adc6ff" fill="rgba(173,198,255,0.22)" height={22} />
        </Panel>
        <Panel className="p-2.5">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('payload')}</Micro>
            <ChartPie className="w-3.5 h-3.5 text-tert" aria-hidden />
          </div>
          <div className="flex items-baseline gap-1 mt-1" dir="ltr">
            <span className="text-xl font-bold text-ink tnum">{(transferredMB / 1024).toFixed(2)}</span>
            <span className="label-xs text-faint">GB</span>
          </div>
          <div className="w-full bg-surf-highest h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div className="bg-tert h-full rounded-full transition-all" style={{ width: `${Math.min(100, (transferredMB / 10240) * 100)}%` }} />
          </div>
        </Panel>
      </div>

      {/* Cipher & endpoint panel */}
      <Panel className="p-4 flex flex-col gap-3" glow={connected ? 'prim' : undefined}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-prim" aria-hidden />
            <Micro className="text-ink-var">{T('cryptoProfile')}</Micro>
          </div>
          <Pill color="text-prim" bg="bg-prim/10">{T('zeroTrustHw')}</Pill>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surf-lowest border border-seam p-2.5 rounded">
            <Micro>{T('tunnelIp')}</Micro>
            <span className="mono label-md text-ink font-bold mt-0.5 block tnum" dir="ltr">10.244.18.92</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2.5 rounded">
            <Micro>{T('gateway')}</Micro>
            <span className="mono label-md text-ink font-bold mt-0.5 block tnum" dir="ltr">185.220.101.4</span>
          </div>
        </div>
        <div className="flex items-center justify-between bg-surf-lowest border border-seam px-3.5 py-2.5 rounded-lg">
          <div className="flex flex-col">
            <Micro>{T('cipherSuite')}</Micro>
            <span className="label-sm text-ink mono mt-0.5" dir="ltr">
              {settings.protocol === 'wireguard' ? 'ChaCha20-Poly1305 / WG-T' : settings.protocol === 'ss2022' ? 'BLAKE3 / SS-2022' : 'TLS 1.3 / AES-256-GCM'}
            </span>
          </div>
          {settings.killSwitch && (
            <div className="flex items-center gap-1.5 bg-sec/15 text-sec px-2.5 py-1 rounded">
              <span className="label-xs uppercase font-bold tracking-wider">{T('killSwitchArmed')}</span>
            </div>
          )}
        </div>

        {/* Endpoint explainability */}
        {selected && (
          <div className="bg-surf-lowest border border-seam rounded-lg p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Micro className="text-prim">{T('endpointScore')}</Micro>
              <span className="mono label-xs text-sec tnum" dir="ltr">{selected.score.toFixed(1)}/100</span>
            </div>
            <div className="mono text-[11px] text-muted leading-5" dir="ltr">
              {selected.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-sec shrink-0">▸</span>
                  <span className="truncate">{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Security subsystems */}
      <div className="flex flex-col gap-2">
        <Micro className="text-ink-var px-1">{T('securitySubsystems')}</Micro>
        {(
          [
            ['multiHop', T('multiHop'), T('multiHopSub'), '#adc6ff'],
            ['dnsGuard', T('dnsGuard'), T('dnsGuardSub'), '#4edea3'],
            ['stealth', T('stealth'), T('stealthSub'), '#ffb95f'],
          ] as const
        ).map(([key, title, sub, color]) => (
          <Panel key={key} className="flex items-center justify-between p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded bg-surf-high flex items-center justify-center shrink-0" style={{ color }}>
                <StatusDot color={color} breathe={subsystems[key]} size={8} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] text-ink font-medium truncate">{title}</span>
                <span className="label-xs text-muted truncate" dir="auto">{sub}</span>
              </div>
            </div>
            <TacticalToggle
              checked={subsystems[key]}
              onChange={(v) => setSubsystems((s) => ({ ...s, [key]: v }))}
              onColor={key === 'stealth' ? '#f59e0b' : '#10b981'}
              label={title}
            />
          </Panel>
        ))}
      </div>

      {/* fingerprint audit snippet */}
      <div className="flex items-center justify-between bg-surf-lowest border border-seam p-2.5 rounded-lg text-ink-var">
        <span className="mono label-xs truncate" dir="ltr">FINGERPRINT: SHA256:7f9e8a1d4b2e…9b2a</span>
        <button type="button" className="label-xs text-prim hover:text-ink font-semibold tracking-wider cursor-pointer">
          {T('verify')}
        </button>
      </div>
    </div>
  );
}
