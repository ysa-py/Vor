'use client';

/**
 * View C — Vor License Manager (admin console).
 * Mirrors the manager stitch screens: authority banner, stats bento, issued
 * entitlements, tamper-evident audit ledger, key rotation, HWID audit and the
 * Issue-License / Bind-HWID glassy modals. Everything signs REAL Ed25519.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  ShieldUser,
  Archive,
  BadgeCheck,
  Ban,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Lock,
  LockOpen,
  Gavel,
  ReceiptText,
  ShieldCheck,
  ShieldAlert,
  Fingerprint as FingerprintIcon,
  CalendarClock,
  CircleDot,
} from 'lucide-react';
import { useVor, lsGet, lsSet, t } from '@/lib/vor/store';
import { machineHwid, hwidDisplay, normalizeHwid } from '@/lib/vor/hwid';
import { appendAudit, auditRoot, verifyAuditChain, type AuditEntry } from '@/lib/vor/audit';
import {
  ALL_ENTITLEMENTS,
  ENTITLEMENT_LABELS,
  FORMAT_VERSION,
  type Entitlement,
  type LicenseTier,
} from '@/lib/vor/license';
import {
  buildPayload,
  deriveKeyId,
  generateKeystore,
  issueLicense,
  rotateKeystore,
  trustedFromKeystore,
  type KeyRecord,
  type KeyStore,
} from '@/lib/vor/keystore';
import { Modal, Micro, Panel, Pill, PrimaryButton, TacticalInput, GhostButton, CopyBtn } from './primitives';

interface StoredLicense {
  license_id: string;
  org: string;
  envelope: string;
  tier: LicenseTier;
  issued_at: number;
  expires_at: number;
  max_devices: number;
  bound_hwids: string[];
  entitlements: Entitlement[];
  metadata?: string;
  revoked: boolean;
  revoked_reason?: string;
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function download(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ */


/** Pure localStorage snapshot loader (module scope → compiler-friendly). */
function loadManagerData() {
  return {
    ks: lsGet<KeyStore | null>('vor.keystore', null),
    licenses: lsGet<StoredLicense[]>('vor.licenses', []),
    audit: lsGet<AuditEntry[]>('vor.audit', []),
    revoked: lsGet<string[]>('vor.revoked', []),
    deviceHwid: machineHwid(),
  };
}

export function ManagerView() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const unlocked = useVor((s) => s.managerUnlocked);
  const setUnlocked = useVor((s) => s.setManagerUnlocked);
  const logEvent = useVor((s) => s.logEvent);

  const [passcode, setPasscode] = useState('');
  const [ks, setKs] = useState<KeyStore | null>(null);
  const [licenses, setLicenses] = useState<StoredLicense[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [revoked, setRevoked] = useState<string[]>([]);
  const [deviceHwid, setDeviceHwid] = useState('');

  const [issueOpen, setIssueOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<StoredLicense | null>(null);
  const [section, setSection] = useState<'overview' | 'licenses' | 'hwid' | 'ledger' | 'keys'>('overview');

  /* --- data loading ------------------------------------------------- */
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- setters + module loader are stable; the compiler cannot model localStorage reads
  const reload = useCallback(() => {
    const d = loadManagerData();
    setKs(d.ks);
    setLicenses(d.licenses);
    setAudit(d.audit);
    setRevoked(d.revoked);
    setDeviceHwid(d.deviceHwid);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    // Deferred load keeps the effect free of synchronous setState cascades.
    const id = setTimeout(reload, 0);
    return () => clearTimeout(id);
  }, [unlocked, reload]);

  const pushAudit = useCallback((action: string, detail: string) => {
    setAudit((prev) => {
      const entry = appendAudit(prev, nowSecs(), action, detail);
      const next = [...prev, entry];
      lsSet('vor.audit', next);
      return next;
    });
  }, []);

  /* --- passcode gate -------------------------------------------------- */
  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-surf border border-seam flex items-center justify-center text-prim">
          <ShieldUser className="w-8 h-8" aria-hidden />
        </div>
        <h2 className="text-lg font-bold text-ink">{T('passcodeTitle')}</h2>
        <p className="text-xs text-muted text-center">{T('passcodeDesc')}</p>
        <div className="w-full max-w-xs flex flex-col gap-2">
          <TacticalInput
            value={passcode}
            onChange={setPasscode}
            type="password"
            ariaLabel={T('passcodeTitle')}
            placeholder="••••"
          />
          <PrimaryButton
            onClick={() => {
              if (passcode.trim().length >= 4) setUnlocked(true);
            }}
          >
            <LockOpen className="w-4 h-4" aria-hidden />
            {T('enter')}
          </PrimaryButton>
        </div>
        <p className="label-xs text-faint uppercase text-center">{T('managerNote')}</p>
      </div>
    );
  }

  if (!ks) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 flex flex-col items-center gap-4">
        <Panel className="p-5 w-full flex flex-col gap-3 items-center text-center">
          <KeyRound className="w-8 h-8 text-tert" aria-hidden />
          <p className="text-sm text-ink">NO KEYSTORE — می‌توانید کی‌استور مدیر را ایجاد کنید</p>
          <p className="text-xs text-muted">Create the Ed25519 issuing keystore (local, this browser only).</p>
          <PrimaryButton
            onClick={() => {
              const store = generateKeystore(nowSecs());
              lsSet('vor.keystore', store);
              lsSet('vor.trusted', trustedFromKeystore(store));
              pushAudit('KEYGEN', `keystore created — active key ${store.active_key_id}`);
              logEvent('manager', 'ok', `issuing keystore generated — key_id=${store.active_key_id}`);
              reload();
            }}
          >
            <KeyRound className="w-4 h-4" aria-hidden />
            GENERATE KEYSTORE
          </PrimaryButton>
        </Panel>
      </div>
    );
  }

  const activeRecords: KeyRecord[] = Object.values(ks.keys);
  const activeKey = activeRecords.find((k) => k.key_id === ks.active_key_id);
  const chainBroken = verifyAuditChain(audit) !== -1;

  const stats = {
    active: licenses.filter((l) => !l.revoked && l.expires_at > nowSecs()).length,
    revoked: licenses.filter((l) => l.revoked).length + revoked.length,
    expiring: licenses.filter((l) => !l.revoked && l.expires_at > nowSecs() && l.expires_at < nowSecs() + 30 * 86400).length,
  };

  const revoke = (l: StoredLicense) => {
    const reason = 'operator revocation (console)';
    setLicenses((prev) => {
      const next = prev.map((x) => (x.license_id === l.license_id ? { ...x, revoked: true, revoked_reason: reason } : x));
      lsSet('vor.licenses', next);
      return next;
    });
    setRevoked((prev) => {
      const next = prev.includes(l.license_id) ? prev : [...prev, l.license_id];
      lsSet('vor.revoked', next);
      return next;
    });
    pushAudit('REVOKE_EVENT', `license ${l.license_id.slice(0, 8)} blacklisted — ${reason}`);
    logEvent('manager', 'warn', `license ${l.license_id.slice(0, 8)} revoked — CRL updated locally`);
  };

  const bindHwid = (l: StoredLicense, hwid: string, label: string) => {
    const norm = normalizeHwid(hwid);
    const payload = buildPayload({
      now: nowSecs(),
      days: (l.expires_at - nowSecs()) / 86400,
      keyId: ks.active_key_id,
      tier: l.tier,
      entitlements: l.entitlements,
      maxDevices: l.max_devices,
      boundHwids: Array.from(new Set([...l.bound_hwids, norm])),
      metadata: l.metadata,
      licenseId: l.license_id,
    });
    try {
      const issued = issueLicense(ks, payload);
      setLicenses((prev) => {
        const next = prev.map((x) =>
          x.license_id === l.license_id ? { ...x, envelope: issued.envelope, bound_hwids: payload.device_policy.bound_hwids } : x,
        );
        lsSet('vor.licenses', next);
        return next;
      });
      pushAudit('HWID_BIND', `node ${label || hwidDisplay(norm, 6, 6)} bound to license ${l.license_id.slice(0, 8)} (re-signed)`);
      logEvent('manager', 'ok', `HWID bound & license re-signed — ${l.license_id.slice(0, 8)} now carries ${payload.device_policy.bound_hwids.length} node(s)`);
      setBindTarget(null);
    } catch (e) {
      logEvent('manager', 'error', `bind failed: ${String(e)}`);
    }
  };

  const rotate = (retireOld: boolean) => {
    const next = rotateKeystore(ks, nowSecs(), retireOld);
    lsSet('vor.keystore', next);
    lsSet('vor.trusted', trustedFromKeystore(next));
    pushAudit(retireOld ? 'ROTATE_HARD' : 'ROTATE_SOFT', `active key → ${next.active_key_id}${retireOld ? ' (old keys RETIRED — fail-closed)' : ' (old keys stay verifiable)'}`);
    logEvent('manager', 'ok', `key rotation complete — new active key ${next.active_key_id} (${retireOld ? 'hard' : 'soft'} rotate)`);
    reload();
  };

  return (
    <div className="w-full px-4 pb-10">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-4">
        {/* admin rail */}
        <nav className="lg:w-[260px] shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible vor-scroll" aria-label="Manager sections">
          {(
            [
              ['overview', 'Overview', <ShieldCheck key="i" className="w-4 h-4" />],
              ['licenses', 'Issued Entitlements', <BadgeCheck key="i" className="w-4 h-4" />],
              ['hwid', 'HWID Node Audit', <FingerprintIcon key="i" className="w-4 h-4" />],
              ['ledger', 'Audit Ledger', <Gavel key="i" className="w-4 h-4" />],
              ['keys', 'Key Operations', <KeyRound key="i" className="w-4 h-4" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg label-xs uppercase tracking-wider whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                section === id ? 'bg-surf-high text-prim border border-seam-strong' : 'text-muted hover:text-ink border border-transparent'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
          <p className="hidden lg:block mt-3 text-[11px] leading-5 text-tert bg-tert/10 border border-tert/30 rounded p-2.5" dir="auto">
            {T('managerNote')}
          </p>
        </nav>

        {/* content */}
        <div className="flex-1 min-w-0 flex flex-col gap-3.5">
          {/* authority banner */}
          <Panel className="p-4 relative overflow-hidden flex flex-col gap-2.5" glow="prim">
            <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-prim/10 blur-2xl pointer-events-none" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <ShieldCheck className="w-4 h-4 text-sec" aria-hidden />
                  <span className="label-xs uppercase tracking-wider text-sec">{T('hsmLevel')}</span>
                </div>
                <h1 className="text-xl font-bold text-ink tracking-tight truncate">{T('vorAuthority')}</h1>
                <span className="label-xs text-ink-var uppercase" dir="ltr">VLA v2.4-RELEASE // {T('cluster')}</span>
              </div>
              <span className="bg-surf px-2 py-1 rounded text-center shrink-0">
                <span className="label-xs text-prim block">ONLINE</span>
                <span className="label-xs text-faint opacity-70">ENCLAVE</span>
              </span>
            </div>
            {/* active signing key */}
            <div className="bg-surf-lowest/80 rounded-lg p-2.5 flex flex-col gap-1 border border-seam">
              <div className="flex items-center justify-between">
                <Micro>{T('activeSigningKey')}</Micro>
                <span className="flex items-center gap-1 label-xs text-sec">
                  <span className="w-1.5 h-1.5 rounded-full bg-sec animate-ping" aria-hidden />
                  {T('enclaveLocked')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="label-sm text-prim tracking-tight truncate mono" dir="ltr">
                  {activeKey?.key_id ?? '—'} ({FORMAT_VERSION === 2 ? 'Ed25519' : ''})
                </span>
                <CopyBtn value={activeKey?.key_id ?? ''} className="!h-7" />
              </div>
              <span className="mono text-[10px] text-faint truncate" dir="ltr">
                PK: {activeKey?.public?.slice(0, 32) ?? ''}…
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIssueOpen(true);
              }}
              className="w-full bg-prim-deep hover:bg-prim-action text-[#f8fafc] py-2.5 px-4 rounded-lg label-md uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prim-action"
            >
              <UserPlus className="w-5 h-5" aria-hidden />
              {T('issueNew')}
            </button>
          </Panel>

          {/* stats bento */}
          <section className="grid grid-cols-3 gap-2">
            {[
              { label: T('statActive'), v: stats.active, color: 'text-sec', dot: 'bg-sec' },
              { label: T('statRevoked'), v: stats.revoked, color: 'text-err', dot: 'bg-err' },
              { label: T('statExpiring'), v: stats.expiring, color: 'text-tert', dot: 'bg-tert' },
            ].map((s) => (
              <Panel key={s.label} className="p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <Micro className="truncate">{s.label}</Micro>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden />
                </div>
                <div className="mt-1.5">
                  <span className={`text-2xl font-bold tnum ${s.color}`}>{s.v}</span>
                </div>
              </Panel>
            ))}
          </section>

          {/* OVERVIEW + LICENSES section */}
          {(section === 'overview' || section === 'licenses') && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4 text-prim" aria-hidden />
                  <h2 className="label-md uppercase tracking-wider text-ink">{T('issuedEntitlements')}</h2>
                </div>
                <span className="label-xs text-faint uppercase">{licenses.length} TOTAL</span>
              </div>
              {licenses.length === 0 && (
                <Panel className="p-4 text-center text-xs text-faint">{T('noneYet')}</Panel>
              )}
              {licenses.map((l) => {
                const expired = l.expires_at <= nowSecs();
                const status = l.revoked ? 'revoked' : expired ? 'expired' : 'active';
                return (
                  <article key={l.license_id} className="bg-surf-high rounded-lg p-4 shadow-md flex flex-col gap-2.5 border border-seam">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-base font-semibold truncate ${l.revoked ? 'line-through opacity-80' : ''} text-ink`}>
                            {l.org}
                          </span>
                          <Pill color={l.tier === 'enterprise' ? 'text-prim' : l.tier === 'pro' ? 'text-sec' : 'text-ink-var'} bg="bg-surf">
                            {l.tier.toUpperCase()}
                          </Pill>
                        </div>
                        <span className="text-[11px] text-faint truncate" dir="ltr">{l.metadata ?? '—'}</span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 label-xs px-2 py-0.5 rounded shrink-0 ${
                          status === 'active'
                            ? 'bg-sec-container/40 text-sec'
                            : status === 'expired'
                              ? 'bg-tert/20 text-tert'
                              : 'bg-err-container text-on-err-container'
                        }`}
                      >
                        <CircleDot className="w-2.5 h-2.5" aria-hidden />
                        {status === 'active' ? T('statusActive') : status === 'expired' ? T('expiredBadge') : T('statusRevoked')}
                      </span>
                    </div>
                    <div className="bg-surf-lowest p-2 rounded flex items-center justify-between gap-2 border border-seam">
                      <span className="mono label-xs text-prim tracking-tighter truncate" dir="ltr">
                        VORLIC1.{l.envelope.split('.')[1]?.slice(0, 24) ?? ''}….{l.envelope.split('.')[3]?.slice(0, 8) ?? ''}
                      </span>
                      <CopyBtn value={l.envelope} className="!h-7">
                        <Copy className="w-3.5 h-3.5" />
                      </CopyBtn>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <div className="bg-surf/60 p-2 rounded flex flex-col">
                        <Micro>{T('boundNodes')}</Micro>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Fingerprint className="w-3.5 h-3.5 text-sec shrink-0" aria-hidden />
                          <span className="label-sm text-ink font-semibold tnum" dir="ltr">
                            {l.bound_hwids.length} / {l.max_devices || T('unlimited')}
                          </span>
                        </div>
                      </div>
                      <div className="bg-surf/60 p-2 rounded flex flex-col">
                        <Micro>{T('validUntil')}</Micro>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <CalendarClock className="w-3.5 h-3.5 text-faint shrink-0" aria-hidden />
                          <span className="label-sm text-ink font-semibold tnum" dir="ltr">
                            {new Date(l.expires_at * 1000).toISOString().slice(0, 10)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] mono text-muted" dir="ltr">
                      {l.entitlements.map((e) => (
                        <span key={e} className="bg-surf px-1.5 py-0.5 rounded-2px border border-seam">
                          {e}
                        </span>
                      ))}
                    </div>
                    {l.revoked && (
                      <div className="bg-err-container/20 rounded p-2.5 flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-err shrink-0 mt-0.5" aria-hidden />
                        <div className="flex flex-col">
                          <span className="label-xs text-err font-semibold uppercase">{T('revokedLicense')}</span>
                          <span className="text-[11px] text-on-err-container">{l.revoked_reason}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setBindTarget(l)}
                        className="px-2.5 py-1 rounded bg-surf hover:bg-surf-highest text-ink label-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Fingerprint className="w-3.5 h-3.5" aria-hidden />
                        {T('bindHwid')}
                      </button>
                      <button
                        type="button"
                        onClick={() => download(`VOR-${l.license_id.slice(0, 8)}.vorlic`, JSON.stringify({ format: 'VORLIC', version: 2, envelope: l.envelope }, null, 2))}
                        className="px-2.5 py-1 rounded bg-surf hover:bg-surf-highest text-ink label-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden />
                        {T('downloadVorlic')}
                      </button>
                      {!l.revoked && (
                        <button
                          type="button"
                          onClick={() => revoke(l)}
                          className="px-2.5 py-1 rounded bg-err-container/40 hover:bg-err-container text-err label-xs flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" aria-hidden />
                          {T('revoke')}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {/* HWID AUDIT */}
          {section === 'hwid' && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <FingerprintIcon className="w-4 h-4 text-sec" aria-hidden />
                <h2 className="label-md uppercase tracking-wider text-ink">{T('hwidAudit')}</h2>
              </div>
              <Panel className="p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between bg-surf-lowest border border-seam p-2.5 rounded">
                  <div className="min-w-0">
                    <Micro>THIS CONSOLE DEVICE (SHA256)</Micro>
                    <span className="mono label-sm text-ink truncate block" dir="ltr">{hwidDisplay(deviceHwid, 12, 12)}</span>
                  </div>
                  <CopyBtn value={deviceHwid} className="!h-7">{T('copy')}</CopyBtn>
                </div>
                {licenses.filter((l) => l.bound_hwids.length > 0).length === 0 ? (
                  <p className="text-xs text-faint text-center py-3">No HWID-bound licenses yet.</p>
                ) : (
                  licenses
                    .filter((l) => l.bound_hwids.length > 0)
                    .flatMap((l) =>
                      l.bound_hwids.map((h, i) => (
                        <div key={`${l.license_id}-${i}`} className="flex items-center justify-between bg-surf-lowest border border-seam p-2.5 rounded">
                          <div className="min-w-0">
                            <span className="mono text-[11px] text-ink truncate block" dir="ltr">{h}</span>
                            <span className="label-xs text-faint" dir="ltr">
                              LIC {l.license_id.slice(0, 8)} · {l.org}
                            </span>
                          </div>
                          <Pill color={l.revoked ? 'text-err' : 'text-sec'} bg="bg-surf-high">
                            {l.revoked ? 'REVOKED' : 'BOUND'}
                          </Pill>
                        </div>
                      )),
                    )
                )}
              </Panel>
            </section>
          )}

          {/* AUDIT LEDGER */}
          {section === 'ledger' && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-sec" aria-hidden />
                  <h2 className="label-md uppercase tracking-wider text-ink">{T('auditLedger')}</h2>
                </div>
                <span className={`label-xs ${chainBroken ? 'text-err' : 'text-sec'}`}>
                  {chainBroken ? T('chainBroken') : T('chainVerified')}
                </span>
              </div>
              <Panel className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between label-xs text-faint" dir="ltr">
                  <span>MERKLE ROOT (TAIL):</span>
                  <span className={`mono ${chainBroken ? 'text-err' : 'text-sec'}`}>
                    {auditRoot(audit).slice(0, 34)}…
                  </span>
                </div>
                <div className="bg-surf-lowest border border-seam rounded-lg p-2.5 flex flex-col max-h-72 overflow-y-auto vor-scroll" dir="ltr">
                  {audit.length === 0 && <p className="text-xs text-faint text-center py-2">Ledger empty.</p>}
                  {audit.map((e) => (
                    <div key={e.seq} className="flex items-start gap-2 py-1.5 border-b border-seam/40 last:border-0">
                      <span className="text-faint shrink-0 mono text-[10px]">[{new Date(e.ts * 1000).toISOString().slice(11, 19)}]</span>
                      <div className="flex-1 min-w-0">
                        <span className={`mono text-[11px] font-bold ${e.action.startsWith('REVOKE') ? 'text-err' : e.action.startsWith('ROTATE') ? 'text-tert' : 'text-sec'}`}>
                          {e.action}:
                        </span>
                        <span className="text-ink text-[11px] ms-1.5">{e.detail}</span>
                        <div className="mono text-[9px] text-faint truncate" dir="ltr">
                          #{e.seq} sha256:{e.hash.slice(0, 28)}…
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="label-xs text-faint" dir="auto">
                  hash = SHA-256(canonical({'{'}seq, ts, action, detail, prev_hash{'}'})) — هر دستکاریِ گذشته زنجیره را می‌شکند.
                </p>
              </Panel>
            </section>
          )}

          {/* KEY OPS */}
          {section === 'keys' && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-prim" aria-hidden />
                <h2 className="label-md uppercase tracking-wider text-ink">{T('rotateKey')}</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Panel className="p-4 flex flex-col gap-2">
                  <span className="label-sm text-ink font-semibold">{T('rotateSoft')}</span>
                  <p className="text-[11px] text-faint leading-4" dir="auto">
                    کلید قبلی «Retired» نمی‌شود؛ مجوزهای قدیمی همچنان تأیید می‌شوند.
                  </p>
                  <GhostButton onClick={() => rotate(false)}>{T('rotateKey')} · SOFT</GhostButton>
                </Panel>
                <Panel className="p-4 flex flex-col gap-2">
                  <span className="label-sm text-err font-semibold">{T('rotateHard')}</span>
                  <p className="text-[11px] text-faint leading-4" dir="auto">
                    واکنش به نفوذ: همهٔ کلیدهای قدیمی Retired می‌شوند — مجوزهای قدیمی fail-closed رد می‌شوند.
                  </p>
                  <GhostButton onClick={() => rotate(true)} className="!text-err !border-crimson/40">
                    {T('rotateKey')} · HARD
                  </GhostButton>
                </Panel>
              </div>
              <Panel className="p-4 flex flex-col gap-2.5">
                <Micro>{T('syncTrust')}</Micro>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      lsSet('vor.trusted', trustedFromKeystore(ks));
                      logEvent('manager', 'ok', `client trust store synced — ${Object.keys(ks.keys).length} key(s) published`);
                      pushAudit('TRUST_SYNC', `trusted snapshot v1 published (${Object.keys(ks.keys).length} keys)`);
                    }}
                    className="px-3 py-2.5 rounded-lg bg-surf hover:bg-surf-high transition-colors label-xs uppercase text-ink flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-sec" aria-hidden />
                    {T('synced')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      download('vor-revoked-list.json', JSON.stringify({ revoked, exported_at: nowSecs() }, null, 2));
                      pushAudit('CRL_EXPORT', `${revoked.length} revoked license id(s) exported`);
                    }}
                    className="px-3 py-2.5 rounded-lg bg-surf hover:bg-surf-high transition-colors label-xs uppercase text-ink flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-err" aria-hidden />
                    {T('exportCrl')}
                  </button>
                  <button
                    type="button"
                    onClick={() => download('vor-keystore-backup.json', JSON.stringify(ks, null, 2))}
                    className="px-3 py-2.5 rounded-lg bg-surf hover:bg-surf-high transition-colors label-xs uppercase text-ink flex items-center gap-2 cursor-pointer"
                  >
                    <Archive className="w-4 h-4 text-prim" aria-hidden />
                    {T('backupKeystore')}
                  </button>
                </div>
                <p className="text-[11px] text-faint" dir="auto">
                  کلیدهای قابل‌اعتماد کارخواه از همین مرورگر همگام می‌شوند؛ در استقرار واقعی اسنپ‌شات اعتماد داخل بیلد قرار می‌گیرد.
                </p>
              </Panel>
              <Panel className="p-4 flex flex-col gap-2">
                <Micro>{T('demoTools')}</Micro>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const payload = buildPayload({
                        now: nowSecs(),
                        days: 365,
                        keyId: ks.active_key_id,
                        tier: 'pro',
                        entitlements: ['core_tunnel'],
                        maxDevices: 0,
                        boundHwids: [],
                        metadata: 'demo seed',
                      });
                      const { envelope } = issueLicense(ks, payload);
                      const parts = envelope.split('.');
                      lsSet('vor.demoForged', { type: 'tampered', envelope: `${parts[0]}.${parts[1].slice(0, -4) + 'AAAA'}.${parts[2]}.${parts[3]}` });
                      pushAudit('DEMO_FORGE', 'tampered envelope cached for gate test');
                    }}
                    className="px-3 py-2.5 rounded-lg bg-surf hover:bg-surf-high transition-colors label-xs uppercase text-tert flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldAlert className="w-4 h-4" aria-hidden />
                    {T('demoCreateTampered')}
                  </button>
                </div>
                <p className="text-[11px] text-faint">{T('demoForged')}</p>
              </Panel>
            </section>
          )}
        </div>
      </div>

      {/* Issue modal */}
      <IssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        ks={ks}
        deviceHwid={deviceHwid}
        onIssued={(envelope, file, id, summary) => {
          setLicenses((prev) => {
            const next = [...prev, summary];
            lsSet('vor.licenses', next);
            return next;
          });
          pushAudit('SIG_ISSUED', `key ${ks.active_key_id} authorized license ${id.slice(0, 8)} for ${summary.org}`);
          logEvent('manager', 'ok', `license ISSUED — id=${id.slice(0, 8)} tier=${summary.tier} key=${ks.active_key_id}`);
        }}
      />

      {/* Bind modal */}
      <BindModal
        open={!!bindTarget}
        target={bindTarget}
        onClose={() => setBindTarget(null)}
        onBind={(hwid, label) => bindTarget && bindHwid(bindTarget, hwid, label)}
        deviceHwid={deviceHwid}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Issue License modal                                                  */
/* ------------------------------------------------------------------ */

function IssueModal({
  open,
  onClose,
  ks,
  deviceHwid,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  ks: KeyStore;
  deviceHwid: string;
  onIssued: (envelope: string, file: string, id: string, summary: StoredLicense) => void;
}) {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const [org, setOrg] = useState('');
  const [tier, setTier] = useState<LicenseTier>('pro');
  const [days, setDays] = useState('365');
  const [maxDevices, setMaxDevices] = useState('3');
  const [hwids, setHwids] = useState('');
  const [ents, setEnts] = useState<Entitlement[]>(['core_tunnel', 'stealth_engine']);
  const [meta, setMeta] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ envelope: string; file: string; id: string } | null>(null);

  // Fresh form every time the modal opens (deferred — no effect cascade).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      setResult(null);
      setErr(null);
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

  const submit = () => {
    setErr(null);
    if (!org.trim()) {
      setErr('organization is required');
      return;
    }
    const d = Number(days);
    if (!Number.isFinite(d) || d === 0) {
      setErr('duration must be a non-zero number of days (negative = already expired)');
      return;
    }
    const bound = hwids
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    const payload = buildPayload({
      now: nowSecs(),
      days: d,
      keyId: ks.active_key_id,
      tier,
      entitlements: ents,
      maxDevices: Number(maxDevices) || 0,
      boundHwids: bound,
      metadata: meta,
    });
    try {
      const issued = issueLicense(ks, payload);
      setResult({ envelope: issued.envelope, file: issued.file, id: payload.license_id });
      onIssued(issued.envelope, issued.file, payload.license_id, {
        license_id: payload.license_id,
        org: org.trim(),
        envelope: issued.envelope,
        tier,
        issued_at: payload.issued_at,
        expires_at: payload.expires_at,
        max_devices: payload.device_policy.max_devices,
        bound_hwids: payload.device_policy.bound_hwids,
        entitlements: payload.entitlements,
        metadata: meta || undefined,
        revoked: false,
      });
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="issue-title">
      <div id="issue-title" className="flex items-center gap-2">
        <ShieldUser className="w-5 h-5 text-prim" aria-hidden />
        <span className="text-lg font-semibold text-ink">{T('issueModalTitle')}</span>
      </div>
      {!result ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Micro>{T('orgField')}</Micro>
            <TacticalInput value={org} onChange={setOrg} placeholder="e.g. Apex Cyber Command" ariaLabel={T('orgField')} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1.5">
              <Micro>{T('tierField')}</Micro>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as LicenseTier)}
                className="w-full h-[38px] bg-surf-lowest text-ink mono text-[13px] px-2.5 rounded-4px border border-seam focus:outline-none focus:ring-1 focus:ring-prim-action"
                aria-label={T('tierField')}
              >
                <option value="standard">{T('tierStandard')}</option>
                <option value="pro">{T('tierPro')}</option>
                <option value="enterprise">{T('tierEnterprise')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Micro>{T('maxDevices')}</Micro>
              <TacticalInput value={maxDevices} onChange={setMaxDevices} type="number" min={0} max={999} ariaLabel={T('maxDevices')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Micro>{T('daysField')}</Micro>
            <TacticalInput value={days} onChange={setDays} type="number" ariaLabel={T('daysField')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Micro>{T('hwidBinds')}</Micro>
              <button
                type="button"
                onClick={() => setHwids((h) => (h.trim() ? h : deviceHwid))}
                className="label-xs text-prim hover:underline cursor-pointer"
              >
                {T('useThisDevice')}
              </button>
            </div>
            <textarea
              value={hwids}
              onChange={(e) => setHwids(e.target.value)}
              rows={3}
              dir="ltr"
              spellCheck={false}
              aria-label={T('hwidBinds')}
              placeholder="HWID-SHA256-…"
              className="w-full bg-surf-lowest text-ink text-[12px] mono p-2.5 rounded-4px border border-seam focus:outline-none focus:ring-1 focus:ring-prim-action vor-scroll"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Micro>{T('entitlementsField')}</Micro>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_ENTITLEMENTS.map((e) => (
                <label
                  key={e}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition-colors ${
                    ents.includes(e) ? 'bg-sec/10 border-sec/50' : 'bg-surf-lowest border-seam hover:border-seam-strong'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={ents.includes(e)}
                    onChange={() => setEnts((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))}
                    className="accent-[#10b981]"
                  />
                  <span className="mono text-[11px] text-ink" dir="ltr">{ENTITLEMENT_LABELS[e]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Micro>{T('metadataField')}</Micro>
            <TacticalInput value={meta} onChange={setMeta} ariaLabel={T('metadataField')} mono={false} placeholder="order ref / customer code" />
          </div>
          {err && <p className="text-xs text-err bg-err-container/20 rounded p-2">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <GhostButton onClick={onClose}>{T('cancel')}</GhostButton>
            <button
              type="button"
              onClick={submit}
              className="px-4 py-2.5 rounded-4px bg-prim-deep hover:bg-prim-action text-[#f8fafc] label-sm font-semibold flex items-center gap-1.5 shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
            >
              <Lock className="w-4 h-4" aria-hidden />
              {T('signIssue')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sec">
            <BadgeCheck className="w-5 h-5" aria-hidden />
            <span className="label-md uppercase tracking-wider">{T('envelopeReady')}</span>
          </div>
          <div className="bg-surf-lowest border border-seam rounded p-2.5 mono text-[10.5px] text-prim break-all leading-4 max-h-40 overflow-y-auto vor-scroll" dir="ltr">
            {result.envelope}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CopyBtn value={result.envelope}>{T('copyEnvelope')}</CopyBtn>
            <button
              type="button"
              onClick={() => download(`VOR-${result.id.slice(0, 8)}.vorlic`, result.file)}
              className="h-8 px-2.5 bg-prim-deep hover:bg-prim-action text-[#f8fafc] label-xs rounded-4px flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden />
              {T('downloadVorlic')}
            </button>
          </div>
          <div className="flex justify-end">
            <GhostButton onClick={onClose}>{T('cancel')}</GhostButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Bind HWID modal                                                      */
/* ------------------------------------------------------------------ */

function BindModal({
  open,
  target,
  onClose,
  onBind,
  deviceHwid,
}: {
  open: boolean;
  target: StoredLicense | null;
  onClose: () => void;
  onBind: (hwid: string, label: string) => void;
  deviceHwid: string;
}) {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const [label, setLabel] = useState('');
  const [hwid, setHwid] = useState('');

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      setLabel('');
      setHwid('');
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="bind-title">
      <div id="bind-title" className="flex items-center gap-2">
        <FingerprintIcon className="w-5 h-5 text-prim" aria-hidden />
        <span className="text-lg font-semibold text-ink uppercase tracking-tight">{T('bindHwid')}</span>
      </div>
      {target && (
        <>
          <div className="bg-surf-lowest p-2.5 rounded border border-seam flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="label-sm text-ink truncate">{target.org}</span>
                <Pill color="text-sec" bg="bg-surf-high">{target.tier.toUpperCase()}</Pill>
              </div>
              <div className="mono label-xs text-faint truncate" dir="ltr">LIC {target.license_id}</div>
            </div>
            <div className="text-end shrink-0">
              <div className="label-xs text-prim font-semibold tnum" dir="ltr">
                SLOT #{target.bound_hwids.length + 1} / {target.max_devices || '∞'}
              </div>
              <div className="label-xs text-sec">READY TO BIND</div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Micro>NODE LABEL</Micro>
            <TacticalInput value={label} onChange={setLabel} placeholder="SOC-WORKSTATION-04-NYC" ariaLabel="node label" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Micro>RECEIVED HARDWARE DIGEST (HWID)</Micro>
              <button
                type="button"
                onClick={() => setHwid(deviceHwid)}
                className="label-xs text-prim hover:underline cursor-pointer"
              >
                {T('useThisDevice')}
              </button>
            </div>
            <textarea
              value={hwid}
              onChange={(e) => setHwid(e.target.value)}
              rows={2}
              dir="ltr"
              spellCheck={false}
              aria-label="HWID"
              placeholder="HWID-SHA256-…"
              className="w-full bg-surf-lowest text-ink text-[12px] mono p-2.5 rounded-4px border border-seam focus:outline-none focus:ring-1 focus:ring-prim-action vor-scroll"
            />
          </div>
          <div className="flex items-center gap-2">
            <GhostButton onClick={onClose} className="flex-1">{T('cancel')}</GhostButton>
            <button
              type="button"
              onClick={() => onBind(hwid.trim(), label.trim())}
              disabled={!hwid.trim()}
              className="flex-1 h-11 bg-prim-deep hover:bg-prim-action text-[#f8fafc] label-md font-semibold uppercase tracking-wider rounded shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-[0.98] cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
            >
              <Lock className="w-4 h-4" aria-hidden />
              SIGN & AUTHORIZE NODE
            </button>
          </div>
          <p className="mono label-xs text-faint text-center tracking-wider" dir="ltr">
            ED25519 AIR-GAPPED ATTESTATION • RE-SIGNS PAYLOAD CANONICALLY
          </p>
        </>
      )}
    </Modal>
  );
}
