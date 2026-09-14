'use client';

/**
 * View B-5 — Settings: kernel config & crypto engine cards (mirrors the
 * stitch kernel-settings screen), config/subscription import with the local
 * parser, and the on-device QR of the active profile.
 */
import { useEffect, useRef, useState } from 'react';
import { Cpu, KeyRound, QrCode, ScanQrCode, ShieldCheck, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import { useVor, lsGet, lsSet, t } from '@/lib/vor/store';
import { parseSubscription, type ParsedProfile } from '@/lib/vor/subscription';
import { Micro, Panel, Pill, PrimaryButton, TacticalInput, TacticalToggle } from './primitives';

interface StoredProfile {
  raw: string;
  protocol: string;
  address: string;
  port: number;
}

export function SettingsTab() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const settings = useVor((s) => s.settings);
  const update = useVor((s) => s.updateSettings);
  const logEvent = useVor((s) => s.logEvent);

  const [importText, setImportText] = useState('');
  const [results, setResults] = useState<{ ok: boolean; label: string; raw?: string }[] | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  // Lazy init — renders post-boot only (hydration-safe, no effect cascade).
  const [active, setActive] = useState<StoredProfile | null>(() =>
    lsGet<StoredProfile | null>('vor.activeProfile', null),
  );

  useEffect(() => {
    if (!active || !qrRef.current) return;
    QRCode.toCanvas(
      qrRef.current,
      active.raw,
      { width: 180, margin: 1, color: { dark: '#dee2ee', light: '#0f141c' } },
      () => undefined,
    );
  }, [active]);

  const flash = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const runImport = () => {
    const parsed = parseSubscription(importText);
    const out = parsed.map((r) =>
      r.ok
        ? {
            ok: true,
            label: `${r.profile.protocol.toUpperCase()} ${r.profile.endpoint.address}:${r.profile.endpoint.port}${r.profile.endpoint.sni ? ` · SNI ${r.profile.endpoint.sni}` : ''}`,
            raw: r.profile.raw,
          }
        : { ok: false, label: r.error.kind === 'unsupported_scheme' ? `unsupported scheme: ${r.error.scheme}` : r.error.kind === 'empty' ? 'empty input' : `malformed (${r.error.reason})` },
    );
    setResults(out);
    const okCount = out.filter((o) => o.ok).length;
    logEvent('subscription', okCount > 0 ? 'ok' : 'error', `local parse finished — ${okCount}/${out.length} profiles valid (no network touched)`);
  };

  const activate = (raw: string) => {
    const parsed = parseSubscription(raw);
    if (!parsed[0]?.ok) return;
    const p: ParsedProfile = parsed[0].profile;
    const stored: StoredProfile = { raw, protocol: p.protocol, address: p.endpoint.address, port: p.endpoint.port };
    setActive(stored);
    lsSet('vor.activeProfile', stored);
    logEvent('profile', 'ok', `active profile set → ${p.protocol} ${p.endpoint.address}:${p.endpoint.port}`);
  };

  const protocols = [
    { id: 'wireguard', title: 'WireGuard-ChaCha20-Poly1305', sub: 'Hardware Kernel Accelerated (AVX-512 offload)', badge: 'OPTIMAL', badgeC: 'text-sec' },
    { id: 'xtls_reality', title: 'XTLS-Reality (Vision)', sub: 'SNI impersonation • uTLS fingerprint', badge: 'ANTI-DPI', badgeC: 'text-tert' },
    { id: 'vless_ws_cdn', title: 'VLESS-WS-TLS-CDN', sub: 'WebSocket behind CDN • blackout-resilient', badge: 'CDN', badgeC: 'text-prim' },
    { id: 'ss2022', title: 'Shadowsocks-2022 (AEAD)', sub: 'BLAKE3 keyed • UDP morphing', badge: 'BYPASS', badgeC: 'text-muted' },
  ] as const;

  return (
    <div className="flex flex-col gap-3.5">
      {/* header card */}
      <Panel className="p-4 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-36 h-36 bg-prim/5 rounded-full blur-2xl pointer-events-none" aria-hidden />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-prim" aria-hidden />
            <span className="label-sm text-ink uppercase tracking-wider">{T('kernelSettings')}</span>
          </div>
          <Pill color="text-prim" bg="bg-surf">FIPS 140-3 L3</Pill>
        </div>
        <div className="flex items-baseline justify-between pt-1.5">
          <div>
            <p className="text-xs text-ink-var">
              {T('hostBinding')}: <span className="mono label-xs text-prim" dir="ltr">TPM20-CHIP-98A4-VOR</span>
            </p>
          </div>
          <div className="text-end">
            <Micro>{T('profileIntegrity')}</Micro>
            <span className="label-sm text-sec font-semibold block">{savedFlash ? T('saved') : T('untouched')}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 pt-2">
          <div className="bg-surf-lowest border border-seam p-2 rounded flex flex-col">
            <Micro>MTU Clamp</Micro>
            <span className="label-sm text-ink font-semibold tnum" dir="ltr">{settings.mtu} B</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2 rounded flex flex-col">
            <Micro>Key Horizon</Micro>
            <span className="label-sm text-tert font-semibold tnum" dir="ltr">{settings.rekeyMin}:00</span>
          </div>
          <div className="bg-surf-lowest border border-seam p-2 rounded flex flex-col">
            <Micro>DNS</Micro>
            <span className="label-sm text-sec font-semibold uppercase" dir="ltr">{settings.dnsMode}</span>
          </div>
        </div>
      </Panel>

      {/* protocol engine */}
      <Panel className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-prim" aria-hidden />
            <span className="text-base font-semibold text-ink">{T('protoEngine')}</span>
          </div>
          <Pill color="text-muted" bg="bg-surf-high">L2/L3 BYPASS</Pill>
        </div>
        <div className="flex flex-col gap-1.5">
          {protocols.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                update({ protocol: p.id });
                flash();
              }}
              aria-pressed={settings.protocol === p.id}
              className={`cursor-pointer rounded p-2.5 flex items-center justify-between transition-all text-start focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                settings.protocol === p.id ? 'bg-surf-high border border-prim/40' : 'bg-surf-lowest border border-seam hover:border-seam-strong'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${settings.protocol === p.id ? 'border-sec bg-sec' : 'border-outline-var'}`} aria-hidden />
                <div className="flex flex-col min-w-0">
                  <span className="label-sm font-semibold text-ink truncate" dir="ltr">{p.title}</span>
                  <span className="text-[11px] text-faint truncate" dir="ltr">{p.sub}</span>
                </div>
              </div>
              <span className={`label-xs px-1.5 py-0.5 rounded-2px bg-surf uppercase shrink-0 ms-2 ${p.badgeC}`} dir="ltr">{p.badge}</span>
            </button>
          ))}
        </div>
      </Panel>

      {/* MTU */}
      <Panel className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label-sm font-semibold text-ink">{T('mtuLabel')}</span>
          </div>
          <span className="label-md text-prim font-bold tnum" dir="ltr">{settings.mtu} Bytes</span>
        </div>
        <p className="text-xs text-ink-var">{T('mtuDesc')}</p>
        <div className="pt-1 flex items-center gap-2.5" dir="ltr">
          <span className="label-xs text-faint">1280</span>
          <input
            type="range"
            min={1280}
            max={1500}
            step={10}
            value={settings.mtu}
            onChange={(e) => update({ mtu: Number(e.target.value) })}
            onMouseUp={flash}
            onTouchEnd={flash}
            className="vor-range w-full"
            aria-label={T('mtuLabel')}
          />
          <span className="label-xs text-faint">1500</span>
        </div>
        <div className="flex justify-between items-center gap-1.5">
          {[
            [1360, 'MSS 1360 (WWAN)'],
            [1420, 'MSS 1420 (STANDARD)'],
            [1492, 'MSS 1492 (PPPoE)'],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                update({ mtu: v as number });
                flash();
              }}
              className={`label-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                settings.mtu === v ? 'text-prim bg-prim/10' : 'text-muted hover:text-prim bg-surf-high'
              }`}
              dir="ltr"
            >
              {label}
            </button>
          ))}
        </div>
      </Panel>

      {/* congestion + rekey */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <span className="label-xs uppercase tracking-wide text-ink-var">{T('congestion')}</span>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {(
            [
              ['bbr', 'TCP BBRv3', 'Low Latency'],
              ['cubic', 'CUBIC', 'Throughput'],
              ['westwood', 'Westwood+', 'Lossy Links'],
            ] as const
          ).map(([id, title, sub]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                update({ congestion: id });
                flash();
              }}
              aria-pressed={settings.congestion === id}
              className={`py-2 px-1 rounded-4px transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                settings.congestion === id ? 'bg-prim-deep text-[#f8fafc]' : 'bg-surf-lowest text-muted hover:text-ink border border-seam'
              }`}
            >
              <span className="label-xs font-semibold block" dir="ltr">{title}</span>
              <span className="text-[9px] opacity-80 block" dir="ltr">{sub}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between bg-surf-lowest border border-seam rounded p-2.5">
          <span className="label-md text-ink uppercase">{T('rekey')}</span>
          <div className="flex items-center gap-2" dir="ltr">
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={settings.rekeyMin}
              onChange={(e) => update({ rekeyMin: Number(e.target.value) })}
              className="vor-range w-28"
              aria-label={T('rekey')}
            />
            <span className="label-sm text-tert font-bold tnum w-10 text-end">{settings.rekeyMin}m</span>
          </div>
        </div>
      </Panel>

      {/* toggles: port hopping / kill switch / auto-connect */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between p-2.5 bg-surf-lowest border border-seam rounded">
          <div className="flex flex-col pe-2">
            <span className="label-md text-ink uppercase">{T('portHopping')}</span>
            <span className="text-[11px] text-faint">{T('portRange')}: <span className="mono" dir="ltr">{settings.portRange}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <TacticalInput
              value={settings.portRange}
              onChange={(v) => update({ portRange: v })}
              ariaLabel={T('portRange')}
              className="!h-8 !w-28"
            />
            <TacticalToggle checked={settings.portHopping} onChange={(v) => update({ portHopping: v })} label={T('portHopping')} />
          </div>
        </div>
        <div className="flex items-center justify-between p-2.5 bg-surf-lowest border border-seam rounded">
          <span className="label-md text-ink uppercase">{T('dnsMode')}</span>
          <div className="flex bg-surf-high rounded-4px p-0.5 gap-0.5">
            {(
              [
                ['doh', 'DoH'],
                ['dot', 'DoT'],
                ['domestic', 'DIRECT'],
                ['bootstrap', 'BOOT'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  update({ dnsMode: id });
                  flash();
                }}
                aria-pressed={settings.dnsMode === id}
                className={`label-xs px-2 py-1 rounded-2px transition-colors cursor-pointer ${
                  settings.dnsMode === id ? 'bg-prim-deep text-[#f8fafc]' : 'text-muted hover:text-ink'
                }`}
                dir="ltr"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between p-2.5 bg-surf-lowest border border-seam rounded">
          <span className="label-md text-ink uppercase">{T('killSwitch')}</span>
          <TacticalToggle checked={settings.killSwitch} onChange={(v) => update({ killSwitch: v })} label={T('killSwitch')} />
        </div>
        <div className="flex items-center justify-between p-2.5 bg-surf-lowest border border-seam rounded">
          <span className="label-md text-ink uppercase">{T('autoConnect')}</span>
          <TacticalToggle checked={settings.autoConnect} onChange={(v) => update({ autoConnect: v })} onColor="#3b82f6" label={T('autoConnect')} />
        </div>
      </Panel>

      {/* config import */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5">
          <Upload className="w-4 h-4 text-prim" aria-hidden />
          <span className="label-md text-ink uppercase tracking-wide">{T('configImport')}</span>
        </div>
        <p className="text-xs text-ink-var">{T('configImportDesc')}</p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          dir="ltr"
          spellCheck={false}
          placeholder="vless://…&#10;vmess://…&#10;ss://…"
          aria-label={T('configImport')}
          className="w-full bg-surf-lowest text-ink text-[12px] mono p-2.5 rounded-4px border border-seam focus:outline-none focus:ring-1 focus:ring-prim-action placeholder:text-outline-var vor-scroll"
        />
        <button
          type="button"
          onClick={runImport}
          className="h-9 rounded-4px bg-prim-deep hover:bg-prim-action text-[#f8fafc] label-xs uppercase font-semibold tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
        >
          {T('parseImport')}
        </button>
        {results && (
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto vor-scroll">
            {results.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded border ${
                  r.ok ? 'bg-sec/5 border-sec/30' : 'bg-err-container/15 border-crimson/40'
                }`}
              >
                <span className={`mono text-[11px] truncate ${r.ok ? 'text-sec' : 'text-err'}`} dir="ltr">
                  {r.ok ? '✓' : '✗'} {r.label}
                </span>
                {r.ok && r.raw && (
                  <button
                    type="button"
                    onClick={() => activate(r.raw!)}
                    className="label-xs text-prim border border-prim/40 rounded-2px px-2 py-0.5 hover:bg-prim/10 shrink-0 cursor-pointer"
                  >
                    {T('useProfile')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* active profile + QR */}
        {active && (
          <div className="flex items-center gap-3 bg-surf-lowest border border-seam rounded-lg p-3">
            <canvas ref={qrRef} width={180} height={180} className="rounded border border-seam shrink-0" aria-label={T('qrLocal')} />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="label-xs text-prim uppercase">{T('activeProfile')}</span>
              <span className="mono text-[11px] text-ink break-all leading-4" dir="ltr">
                {active.protocol.toUpperCase()} → {active.address}:{active.port}
              </span>
              <span className="label-xs text-faint flex items-center gap-1">
                <ScanQrCode className="w-3 h-3" aria-hidden /> {T('qrNote')}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {/* danger zone */}
      <Panel className="p-4 flex flex-col gap-2 border-crimson/30">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-err" aria-hidden />
          <span className="label-md text-ink uppercase tracking-wide">{T('resetAll')}</span>
        </div>
        <p className="text-xs text-faint">{T('resetWarn')}</p>
        <PrimaryButton
          color="danger"
          onClick={() => {
            Object.values(['vor.lang', 'vor.activatedLicense', 'vor.keystore', 'vor.trusted', 'vor.audit', 'vor.revoked', 'vor.settings', 'vor.licenses', 'vor.activeProfile', 'vor.managerOk', 'vor.hwidentity']).forEach((k) => localStorage.removeItem(k));
            location.reload();
          }}
        >
          <KeyRound className="w-4 h-4" aria-hidden />
          {T('resetAll')}
        </PrimaryButton>
      </Panel>
    </div>
  );
}
