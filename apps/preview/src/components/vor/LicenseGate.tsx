'use client';

/**
 * View A — Cryptographic License Gate (first launch, fail-closed).
 * Real Ed25519 verification over canonical JSON; exact verify.rs order.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileUp,
  KeyRound,
  LockKeyhole,
  ScanFace,
  ShieldCheck,
  ShieldAlert,
  LockOpen,
  KeySquare,
} from 'lucide-react';
import { useVor, lsGet, lsSet, LS_KEYS } from '@/lib/vor/store';
import { t } from '@/lib/vor/store';
import { machineHwid, hwidDisplay } from '@/lib/vor/hwid';
import { parseLicenseFileText, envelopeDecode, envelopeEncode } from '@/lib/vor/license';
import {
  buildPayload,
  generateKeystore,
  issueLicense,
  trustedFromKeystore,
  type KeyStore,
} from '@/lib/vor/keystore';
import { canonicalizeStr } from '@/lib/vor/canonical';
import { CopyBtn, Micro, Panel, Pill, PrimaryButton, TacticalInput } from './primitives';

const ERROR_FA: Record<string, string> = {
  E_MALFORMED: 'ساختار پاکت نامعتبر است (base64/UTF-8/فیلدها)',
  E_SCHEMA: 'نسخهٔ طرح‌وارهٔ مجوز پشتیبانی نمی‌شود',
  E_MISSING_FIELD: 'فیلد اجباری در payload موجود نیست',
  E_INVALID_FIELD: 'مقدار فیلد نامعتبر است',
  E_SIGNATURE: 'امضای Ed25519 روی payload معیار تأیید نشد — پاکت دستکاری شده است',
  E_UNTRUSTED_KEY: 'کلیدِ امضاکننده در زنجیرهٔ اعتماد نیست (key_id ناشناس)',
  E_PRODUCT: 'مجوز به محصول دیگری تعلق دارد',
  E_EXPIRED: 'مجوز منقضی شده است',
  E_NOT_YET_VALID: 'مجوز هنوز اعتبار ندارد (not_before در آینده است)',
  E_ENTITLEMENT: 'حقوق (entitlement) ناشناخته در payload',
  E_DEVICE: 'این دستگاه در سیاست اتصال مجوز نیست — عدم تطابق HWID',
  E_REVOKED: 'مجوز در فهرست ابطال محلی قرار دارد',
};

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Demo tooling: bootstrap a local issuing authority if the Manager hasn't yet. */
function ensureDemoAuthority(): KeyStore {
  let ks = lsGet<KeyStore | null>(LS_KEYS.keystore, null);
  if (!ks || !ks.signing_key) {
    ks = generateKeystore(nowSecs());
    lsSet(LS_KEYS.keystore, ks);
  }
  lsSet(LS_KEYS.trusted, trustedFromKeystore(ks));
  return ks;
}

export function LicenseGate() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const verify = useVor((s) => s.verifyAndActivate);
  const report = useVor((s) => s.lastReport);
  const clearReport = useVor((s) => s.clearReport);
  const setView = useVor((s) => s.setView);
  const logEvent = useVor((s) => s.logEvent);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'idle' | 'verifying' | 'arming'>('idle');
  // The gate renders only after client boot, so lazy localStorage init is
  // hydration-safe and avoids setState-in-effect cascades.
  const [hwid] = useState(() => machineHwid());
  const [trustedCount] = useState(() => {
    const trusted = lsGet<{ keys: Record<string, { status: string }> } | null>(LS_KEYS.trusted, null);
    return trusted ? Object.values(trusted.keys).filter((k) => k.status === 'active').length : 0;
  });
  const [activeKey] = useState(() => lsGet<KeyStore | null>(LS_KEYS.keystore, null)?.active_key_id ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  const runVerify = useCallback(
    (envelope: string) => {
      setBusy('verifying');
      clearReport();
      setTimeout(() => {
        const r = verify(envelope);
        if (r.ok) {
          setBusy('arming');
          setTimeout(() => setBusy('idle'), 1200);
        } else {
          setBusy('idle');
        }
      }, 550);
    },
    [clearReport, verify],
  );

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const envelope = parseLicenseFileText(String(reader.result));
        setInput(envelope);
        runVerify(envelope);
      } catch (e) {
        verify('VORLIC1.broken.signature.key'); // → E_MALFORMED, deliberate
        void e;
      }
    };
    reader.readAsText(f);
  };

  const demoTampered = () => {
    const ks = ensureDemoAuthority();
    const payload = buildPayload({
      now: nowSecs(),
      days: 365,
      keyId: ks.active_key_id,
      tier: 'pro',
      entitlements: ['core_tunnel', 'stealth_engine'],
      maxDevices: 3,
      boundHwids: [],
      metadata: 'demo: tamper test',
    });
    const { envelope } = issueLicense(ks, payload);
    // Tamper: flip one signed field, keep the ORIGINAL signature → E_SIGNATURE.
    const parts = envelopeDecode(envelope);
    const doc = JSON.parse(parts.payloadJson) as Record<string, unknown>;
    doc.license_id = '00000000-0000-4000-8000-000000000000';
    const forged = envelopeEncode(canonicalizeStr(JSON.stringify(doc)), parts.sig, parts.pk);
    logEvent('demo', 'warn', 'demo: forged envelope generated (payload edited, original signature kept)');
    runVerify(forged);
  };

  const demoExpired = () => {
    const ks = ensureDemoAuthority();
    const payload = buildPayload({
      now: nowSecs(),
      days: -3,
      keyId: ks.active_key_id,
      tier: 'standard',
      entitlements: ['core_tunnel'],
      maxDevices: 1,
      boundHwids: [],
      metadata: 'demo: expiry test',
    });
    const { envelope } = issueLicense(ks, payload);
    logEvent('demo', 'warn', 'demo: expired license generated (expires_at = now-3d)');
    runVerify(envelope);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setInput(text.trim());
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-col w-full max-w-md mx-auto px-4 py-4 gap-4">
      {/* Air-gapped status pill */}
      <div className="flex items-center justify-between bg-surf-lowest px-4 py-2 rounded-lg border border-seam">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sec opacity-75" aria-hidden />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sec" aria-hidden />
          </span>
          <span className="label-xs text-sec tracking-wider uppercase truncate">{T('gatePill')}</span>
        </div>
        <span className="label-xs text-ink-var truncate">{T('gatePillSub')}</span>
      </div>

      {/* Trust & authority banner */}
      <Panel className="p-4 relative overflow-hidden">
        <div className="absolute -top-16 -end-16 w-44 h-44 bg-prim/5 rounded-full blur-2xl pointer-events-none" aria-hidden />
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-surf-high border border-seam flex items-center justify-center shrink-0 text-prim">
            <ShieldCheck className="w-6 h-6" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Pill color="text-prim" bg="bg-surf-highest">VOR-SEC // LEVEL 4</Pill>
              <Pill color="text-sec" bg="bg-transparent"><LockKeyhole className="w-3 h-3" aria-hidden /> ED25519</Pill>
            </div>
            <h1 className="text-[20px] font-semibold text-ink mt-1.5 leading-7 truncate">{T('gateTitle')}</h1>
            <p className="text-xs text-ink-var mt-0.5 leading-5">{T('gateSubtitle')}</p>
          </div>
        </div>

        {/* HWID strip */}
        <div className="mt-4 bg-surf-lowest p-2.5 rounded-lg border border-seam flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Micro>{T('hwFingerprint')}</Micro>
            <span className="mono label-sm text-ink block truncate tnum" dir="ltr">
              {hwid ? hwidDisplay(hwid, 10, 10) : '…'}
            </span>
          </div>
          <CopyBtn value={hwid}>{T('copy')}</CopyBtn>
        </div>

        {/* trusted keys status */}
        <div className="mt-2 flex items-center justify-between text-[11px]" dir="ltr">
          <span className="mono text-muted">
            TRUSTED KEYS: {trustedCount} · KEY_ID: {activeKey ?? '—'}
          </span>
          <span className="flex items-center gap-1 text-sec">
            <span className="w-1.5 h-1.5 rounded-full bg-sec animate-breathe" aria-hidden />
            {trustedCount > 0 ? T('gateTrustedKeys') : 'EMPTY TRUST STORE'}
          </span>
        </div>
        {trustedCount === 0 && (
          <p className="mt-2 text-[11px] leading-5 text-tert bg-tert/10 border border-tert/30 rounded p-2">
            {T('gateNoKeys')}
          </p>
        )}
      </Panel>

      {/* Auth vector ingestion */}
      <Panel className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="label-sm text-ink uppercase tracking-wider">{T('authVector')}</span>
          <Pill color="text-sec" bg="bg-surf">Deterministic EdDSA</Pill>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <Micro className="text-ink-var">{T('tokenLabel')}</Micro>
            <button type="button" onClick={paste} className="label-xs text-prim hover:underline cursor-pointer">
              {T('paste')}
            </button>
          </div>
          <TacticalInput
            value={input}
            onChange={setInput}
            placeholder={T('tokenPlaceholder')}
            ariaLabel={T('tokenLabel')}
          />
        </div>

        {/* Drop zone */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group cursor-pointer bg-surf-lowest hover:bg-surf transition-colors p-4 rounded-lg border border-dashed border-seam hover:border-seam-strong flex flex-col items-center justify-center text-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
        >
          <div className="w-10 h-10 rounded-full bg-surf flex items-center justify-center text-prim group-hover:scale-105 transition-transform">
            <FileUp className="w-5 h-5" aria-hidden />
          </div>
          <p className="text-[13px] font-semibold text-ink">
            {T('dropTitle')}
          </p>
          <p className="text-xs text-faint">{T('dropSubtitle')}</p>
          <span className="label-xs text-outline-var tracking-wider uppercase">{T('dropHint')}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".vorlic,.lic,.json,.bin"
            className="hidden"
            aria-label="License file input"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </button>
      </Panel>

      {/* Verification failure report — tamper-evident alert */}
      {report && !report.ok && (
        <div className="bg-err-container/25 border border-crimson/60 rounded-lg p-3.5 flex flex-col gap-1.5 glow-err" role="alert">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 label-sm text-err font-semibold uppercase">
              <ShieldAlert className="w-4 h-4" aria-hidden />
              {T('failTitle')}
            </span>
            <span className="mono label-xs bg-crimson/20 text-err px-1.5 py-0.5 rounded-2px" dir="ltr">
              {report.error_code}
            </span>
          </div>
          <p className="text-xs text-on-err-container leading-5" dir="auto">{ERROR_FA[report.error_code ?? ''] ?? '—'}</p>
          <p className="mono text-[10.5px] text-err/80 leading-4 break-words" dir="ltr">
            {report.error}
          </p>
        </div>
      )}

      {/* Primary actuator */}
      <div className="flex flex-col gap-2.5">
        <PrimaryButton onClick={() => runVerify(input.trim())} disabled={busy !== 'idle' || !input.trim()}>
          {busy === 'verifying' ? (
            <>
              <ScanFace className="w-5 h-5 animate-pulse" aria-hidden /> {T('verifying')}
            </>
          ) : busy === 'arming' ? (
            <>
              <LockOpen className="w-5 h-5 text-sec" aria-hidden /> {T('armed')}
            </>
          ) : (
            <>
              <KeyRound className="w-5 h-5" aria-hidden /> {T('verifyBtn')}
            </>
          )}
        </PrimaryButton>

        {/* demo tools */}
        <div className="flex items-center gap-2">
          <span className="label-xs text-faint uppercase shrink-0">{T('demoErrors')}:</span>
          <button
            type="button"
            onClick={demoTampered}
            className="flex-1 h-9 rounded-4px bg-surf hover:bg-surf-high border border-seam text-tert label-xs uppercase transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
          >
            {T('demoTampered')}
          </button>
          <button
            type="button"
            onClick={demoExpired}
            className="flex-1 h-9 rounded-4px bg-surf hover:bg-surf-high border border-seam text-tert label-xs uppercase transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
          >
            {T('demoExpired')}
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-center text-faint">
          <KeySquare className="w-3.5 h-3.5" aria-hidden />
          <span className="label-xs tracking-wider uppercase">{T('airGapNote')}</span>
        </div>
      </div>
    </div>
  );
}
