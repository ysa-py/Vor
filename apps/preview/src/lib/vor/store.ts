/**
 * VOR engine store — single source of truth for the whole preview.
 * Zustand store + a 1 Hz engine loop (telemetry walk, DPI inference,
 * scenario reactions). All timers are cleaned up via stopEngine().
 */
import { create } from 'zustand';
import {
  classify,
  loadModelManifest,
  planFor,
  blackoutPlan,
  stepFeatures,
  ZERO_FEATURES,
  type CountermeasurePlan,
  type DpiFeatures,
  type DpiVerdict,
  type ModelManifest,
  type Scenario,
} from './dpi';
import {
  MAX_ATTEMPTS,
  backoffMs,
  BASE_ENDPOINTS,
  meanLatency,
  pickBest,
  stepTelemetry,
  TRANSPORT_LADDER,
  type DecisionExplanation,
  type EndpointHealth,
  type TelemetryPoint,
  type TransportClass,
  type TunnelState,
} from './tunnel';
import { verifyLicense, type LicensePayload, type VerificationReport } from './keystore';
import { tt, type Lang } from './i18n';

export type View = 'gate' | 'client' | 'manager';
export type ClientTab = 'tunnel' | 'analytics' | 'defense' | 'diagnostics' | 'settings';

export interface EngineEvent {
  ts: number;
  stage: string;
  level: 'info' | 'warn' | 'error' | 'ok';
  message: string;
}

export interface VorSettings {
  protocol: 'wireguard' | 'xtls_reality' | 'vless_ws_cdn' | 'ss2022';
  mtu: number;
  congestion: 'bbr' | 'cubic' | 'westwood';
  rekeyMin: number;
  portHopping: boolean;
  portRange: string;
  dnsMode: 'doh' | 'dot' | 'domestic' | 'bootstrap';
  killSwitch: boolean;
  autoConnect: boolean;
  accent: 'emerald' | 'blue' | 'amber';
}

export const DEFAULT_SETTINGS: VorSettings = {
  protocol: 'wireguard',
  mtu: 1420,
  congestion: 'bbr',
  rekeyMin: 15,
  portHopping: false,
  portRange: '10000-20000',
  dnsMode: 'doh',
  killSwitch: true,
  autoConnect: false,
  accent: 'emerald',
};

/** Persisted activation record: the envelope is re-verified on every boot. */
export interface StoredActivation {
  envelope: string;
  license_id: string;
  activated_at: number;
}

const SERIES_CAP = 48;
const EVENTS_CAP = 200;

interface VorStore {
  booted: boolean;
  lang: Lang;
  view: View;
  tab: ClientTab;

  activated: LicensePayload | null;
  lastReport: VerificationReport | null;
  activationAnim: boolean;

  tunnel: TunnelState;
  attempt: number;
  transport: TransportClass;
  selected: DecisionExplanation | null;
  telemetry: TelemetryPoint;
  series: { down: number[]; up: number[]; latency: number[]; jitter: number[]; loss: number[] };
  sessionStart: number | null;
  endpoints: EndpointHealth[];
  transferredMB: number;

  model: ModelManifest | null;
  modelError: string | null;
  features: DpiFeatures;
  verdict: DpiVerdict | null;
  scenario: Scenario;
  plan: CountermeasurePlan | null;
  activeCms: string[];
  manualOverride: boolean;

  events: EngineEvent[];
  settings: VorSettings;
  managerUnlocked: boolean;

  /* actions */
  boot: () => Promise<void>;
  setLang: (l: Lang) => void;
  setView: (v: View) => void;
  setTab: (t: ClientTab) => void;
  logEvent: (stage: string, level: EngineEvent['level'], message: string) => void;
  verifyAndActivate: (envelope: string, silent?: boolean) => VerificationReport;
  clearReport: () => void;
  deactivate: () => void;
  connect: () => Promise<void>;
  disconnect: (reason?: string) => void;
  setScenario: (s: Scenario) => void;
  toggleCm: (kind: string) => void;
  applyPlan: () => void;
  clearCms: () => void;
  setFeature: (k: keyof DpiFeatures, v: number) => void;
  setManualOverride: (v: boolean) => void;
  updateSettings: (patch: Partial<VorSettings>) => void;
  setManagerUnlocked: (ok: boolean) => void;
  refreshVerdict: () => void;
}

/* ------------------------------------------------------------------ */
/* localStorage helpers                                                */
/* ------------------------------------------------------------------ */

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const LS_KEYS = {
  lang: 'vor.lang',
  activated: 'vor.activatedLicense',
  keystore: 'vor.keystore',
  trusted: 'vor.trusted',
  audit: 'vor.audit',
  revoked: 'vor.revoked',
  licenses: 'vor.licenses',
  settings: 'vor.settings',
  hwidentity: 'vor.hwidentity',
  managerOk: 'vor.managerOk',
};

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function pushSeries(arr: number[], v: number): number[] {
  const next = arr.length >= SERIES_CAP ? arr.slice(arr.length - SERIES_CAP + 1) : arr.slice();
  next.push(v);
  return next;
}

/* ------------------------------------------------------------------ */
/* Connection orchestration (bounded retries, exponential backoff)     */
/* ------------------------------------------------------------------ */

let connectToken = 0;

function sleepChecked(ms: number, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(useVor.getState().connectTokenRef === token), ms);
  });
}

interface VorStoreFull extends VorStore {
  connectTokenRef: number;
  runConnectFor: (token: number) => Promise<void>;
}

export const useVor = create<VorStoreFull>((set, get) => ({
  booted: false,
  lang: 'fa',
  view: 'gate',
  tab: 'tunnel',

  activated: null,
  lastReport: null,
  activationAnim: false,

  tunnel: 'idle',
  attempt: 0,
  transport: 'reality_direct',
  selected: null,
  telemetry: { down: 0, up: 0, latency: 0, jitter: 0, loss: 0 },
  series: { down: [], up: [], latency: [], jitter: [], loss: [] },
  sessionStart: null,
  endpoints: BASE_ENDPOINTS.map((e) => ({ ...e, latencies: [...e.latencies] })),
  transferredMB: 0,

  model: null,
  modelError: null,
  features: { ...ZERO_FEATURES },
  verdict: null,
  scenario: 'calm',
  plan: null,
  activeCms: [],
  manualOverride: false,

  events: [],
  settings: DEFAULT_SETTINGS,
  managerUnlocked: false,

  connectTokenRef: 0,

  boot: async () => {
    const savedLang = lsGet<Lang>(LS_KEYS.lang, 'fa');
    const settings = { ...DEFAULT_SETTINGS, ...lsGet<Partial<VorSettings>>(LS_KEYS.settings, {}) };
    set({ lang: savedLang, settings, booted: true });
    if (typeof document !== 'undefined') {
      document.documentElement.lang = savedLang;
      document.documentElement.dir = savedLang === 'fa' ? 'rtl' : 'ltr';
    }
    get().logEvent('runtime', 'ok', 'VOR secure runtime initialized — offline mode, zero external calls');

    // DPI model — real weights, real inference.
    try {
      const model = await loadModelManifest();
      set({ model });
      get().logEvent(
        'dpi-model',
        'ok',
        `model ${model.version} loaded — 8→16(ReLU)→8(ReLU)→3(softmax), val_acc=${(model.val_accuracy * 100).toFixed(0)}%`,
      );
      get().refreshVerdict();
    } catch (e) {
      set({ modelError: String(e) });
      get().logEvent('dpi-model', 'error', `model manifest unavailable: ${String(e)}`);
    }

    // Cached license re-verification (fail-closed).
    const saved = lsGet<StoredActivation | null>(LS_KEYS.activated, null);
    if (saved?.envelope) {
      const report = get().verifyAndActivate(saved.envelope, true);
      if (!report.ok) {
        lsRemove(LS_KEYS.activated);
      }
    }
  },

  setLang: (l) => {
    set({ lang: l });
    lsSet(LS_KEYS.lang, l);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l;
      document.documentElement.dir = l === 'fa' ? 'rtl' : 'ltr';
    }
  },

  setView: (v) => set({ view: v }),
  setTab: (t) => set({ tab: t }),

  logEvent: (stage, level, message) => {
    set((s) => ({
      events: [...s.events.slice(-(EVENTS_CAP - 1)), { ts: Date.now(), stage, level, message }],
    }));
  },

  verifyAndActivate: (envelope, silent = false) => {
    const trusted = lsGet<Parameters<typeof verifyLicense>[1]>(LS_KEYS.trusted, null);
    const revoked = lsGet<string[]>(LS_KEYS.revoked, []);
    const hwid = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEYS.hwidentity) : null;
    let report: VerificationReport;
    let payload: LicensePayload | null = null;
    try {
      payload = verifyLicense(envelope, trusted, { now: nowSecs(), deviceHwid: hwid, revoked });
      report = {
        ok: true,
        license_id: payload.license_id,
        tier: payload.license_tier,
        key_id: payload.key_id,
        expires_at: payload.expires_at,
        days_remaining: Math.max(0, Math.floor((payload.expires_at - nowSecs()) / 86_400)),
        entitlements: payload.entitlements,
      };
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'E_MALFORMED';
      report = { ok: false, error_code: code, error: (e as Error).message };
    }
    set({ lastReport: report });
    if (report.ok && payload) {
      set({ activated: payload, activationAnim: true, view: 'client' });
      lsSet(LS_KEYS.activated, {
        envelope,
        license_id: payload.license_id,
        activated_at: nowSecs(),
      } satisfies StoredActivation);
      get().logEvent(
        'license',
        'ok',
        `license verified — id=${payload.license_id.slice(0, 8)} key=${payload.key_id} tier=${payload.license_tier} days=${report.days_remaining} (Ed25519 over canonical payload OK)`,
      );
      setTimeout(() => {
        if (useVor.getState().activationAnim) set({ activationAnim: false });
      }, 1600);
    } else if (!silent) {
      get().logEvent('license', 'error', `license REJECTED — ${report.error_code}: ${report.error} (fail-closed)`);
      set({ activated: null });
    } else {
      set({ activated: null });
      get().logEvent('license', 'warn', `cached license failed re-verification (${report.error_code}) — gate remains closed`);
    }
    return report;
  },

  clearReport: () => set({ lastReport: null }),

  deactivate: () => {
    lsRemove(LS_KEYS.activated);
    connectToken++;
    set({
      activated: null,
      lastReport: null,
      view: 'gate',
      tunnel: 'idle',
      sessionStart: null,
      connectTokenRef: connectToken,
    });
    get().logEvent('license', 'info', 'license deactivated — enclave sealed, gate re-armed');
  },

  connect: async () => {
    const token = ++connectToken;
    set({ connectTokenRef: token });
    await get().runConnectFor(token);
  },

  disconnect: (reason) => {
    connectToken++;
    set({ connectTokenRef: connectToken, tunnel: 'idle', sessionStart: null });
    get().logEvent('controller', 'warn', reason ?? 'tunnel torn down by operator — session keys wiped from RAM');
  },

  runConnectFor: async (token) => {
    if (!get().activated) {
      set({ tunnel: 'license_required' });
      get().logEvent('controller', 'error', 'connect refused — no valid license (fail-closed)');
      return;
    }
    const alive = () => useVor.getState().connectTokenRef === token;
    const log = (stage: string, level: 'info' | 'warn' | 'error' | 'ok', m: string) => {
      if (alive()) get().logEvent(stage, level, m);
    };

    set({ attempt: 0, tunnel: 'preparing', sessionStart: null });
    log('controller', 'info', 'connect requested → preparing vor0 interface & kill-switch rules');
    if (!(await sleepChecked(650, token))) return;

    set({ tunnel: 'checking_network' });
    log('network', 'info', 'probing international reachability & DNS integrity (DoH sentinel)…');
    if (!(await sleepChecked(750, token))) return;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!alive()) return;
      if (attempt > 0) {
        const bo = backoffMs(attempt);
        log(
          'controller',
          'warn',
          `attempt ${attempt + 1}/${MAX_ATTEMPTS} — exponential backoff ${bo}ms (500ms·2^${attempt}, cap 8s)`,
        );
        set({ attempt, tunnel: 'reconnecting' });
        if (!(await sleepChecked(Math.min(bo, 2200), token))) return;
      } else {
        set({ attempt, tunnel: 'selecting_transport' });
      }
      if (!alive()) return;
      set({ tunnel: 'selecting_transport' });

      // Endpoint scoring — blackout restricts candidates to CDN-routed ones.
      const scenario = get().scenario;
      const blackout = scenario === 'blackout';
      const candidates = get()
        .endpoints.filter((e) => (blackout ? e.cdn_routed : true))
        .map((health, i) => ({
          health,
          transport: blackout
            ? ('ws_tls_cdn' as TransportClass)
            : TRANSPORT_LADDER[Math.min(i, TRANSPORT_LADDER.length - 1)],
        }));
      const best = pickBest(candidates);
      if (!best) {
        log('scoring', 'error', 'no viable endpoint candidate — fail-closed');
        set({ tunnel: 'config_error' });
        return;
      }
      set({ selected: best, transport: best.transport });
      log(
        'scoring',
        'info',
        `endpoint ${best.endpoint_id} selected — score ${best.score.toFixed(1)}/100 via ${best.transport} | ${best.reasons.join('; ')}`,
      );
      if (blackout) {
        log('blackout', 'warn', 'international blackout suspected → CDN-only strategy + DNS bootstrap 10.202.10.202');
      }

      set({ tunnel: 'connecting' });
      log('transport', 'info', `dialing ${best.endpoint_id} via ${best.transport} (MTU ${get().settings.mtu})…`);
      if (!(await sleepChecked(850, token))) return;
      set({ tunnel: 'handshake' });
      log('tls', 'info', 'X25519 ECDH + Ed25519 certificate binding → ChaCha20-Poly1305 traffic keys…');
      if (!(await sleepChecked(700, token))) return;

      // Failure simulation — DPI scenario injects RST / handshake failures.
      const cms = new Set(get().activeCms);
      const defended = cms.has('client_hello_split') && (cms.has('packet_fragmentation') || cms.has('transport_switch'));
      let failChance = 0.04;
      if (scenario === 'throttling') failChance = 0.15;
      if (scenario === 'active_dpi') failChance = defended ? 0.06 : 0.6;
      if (scenario === 'blackout') failChance = best.transport === 'ws_tls_cdn' ? 0.08 : 0.5;
      if (Math.random() < failChance) {
        const failTypes = [
          'ResetByPeer (RST injection after ClientHello)',
          'TlsBlocked (in-path SNI match)',
          'HandshakeTimeout (9000ms)',
          'DnsFailure (hijacked resolver)',
        ];
        const f = failTypes[Math.floor(Math.random() * failTypes.length)];
        log('transport', 'error', `attempt ${attempt + 1} failed — ${f}`);
        set((s) => ({
          endpoints: s.endpoints.map((e) =>
            e.endpoint_id === best.endpoint_id ? { ...e, fail_streak: e.fail_streak + 1 } : e,
          ),
        }));
        const idx = TRANSPORT_LADDER.indexOf(get().transport);
        const nextTransport = TRANSPORT_LADDER[Math.min(idx + 1, TRANSPORT_LADDER.length - 1)];
        if (nextTransport !== get().transport) {
          set({ transport: nextTransport, tunnel: 'switching_transport' });
          log('controller', 'warn', `escalating fallback ladder → ${nextTransport}`);
          if (!(await sleepChecked(500, token))) return;
        }
        continue;
      }

      // Success.
      set({ tunnel: 'connected', sessionStart: Date.now() });
      set((s) => ({
        endpoints: s.endpoints.map((e) =>
          e.endpoint_id === best.endpoint_id
            ? {
                ...e,
                fail_streak: 0,
                latencies: [...e.latencies.slice(-3), Math.max(8, meanLatency(e) + (Math.random() * 4 - 2))],
              }
            : e,
        ),
      }));
      log('tunnel', 'ok', `TUNNEL ESTABLISHED — ${best.endpoint_id} / ${best.transport} — session keyed, kill-switch armed`);
      return;
    }

    get().logEvent(
      'controller',
      'error',
      `retry budget exhausted (${MAX_ATTEMPTS} attempts) → fail-closed, operator informed`,
    );
    set({ tunnel: 'config_error' });
  },

  setScenario: (s) => {
    set({ scenario: s, activeCms: [], manualOverride: false });
    const label = { calm: 'CALM', throttling: 'THROTTLING', active_dpi: 'ACTIVE_DPI', blackout: 'BLACKOUT' }[s];
    get().logEvent('dpi', 'info', `threat scenario switched → ${label} — feature trajectory retargeted`);
    if (s === 'blackout') {
      set({ plan: blackoutPlan() });
      get().logEvent('blackout', 'warn', 'blackout plan armed: CDN-only transports + bootstrap DNS + MSS 40');
      if (get().tunnel === 'connected') {
        get().disconnect('blackout detected — tearing down non-CDN tunnel');
      }
    }
  },

  toggleCm: (kind) => {
    const on = !get().activeCms.includes(kind);
    set((s) => ({
      activeCms: on ? [...s.activeCms, kind] : s.activeCms.filter((k) => k !== kind),
    }));
    get().logEvent(
      'countermeasure',
      on ? 'ok' : 'info',
      `${kind} ${on ? 'APPLIED → telemetry loop re-converging' : 'removed — channel re-exposed'}`,
    );
  },

  applyPlan: () => {
    const plan = get().plan;
    if (!plan) return;
    const kinds = plan.actions.map((a) => a.kind);
    set({ activeCms: Array.from(new Set([...get().activeCms, ...kinds])) });
    get().logEvent('countermeasure', 'ok', `full plan applied (${kinds.length} actions) — zero-touch mitigation running`);
  },

  clearCms: () => set({ activeCms: [] }),

  setFeature: (k, v) => {
    set((s) => ({ features: { ...s.features, [k]: Math.min(1, Math.max(0, v)) } }));
    get().refreshVerdict();
  },

  setManualOverride: (v) => set({ manualOverride: v }),

  updateSettings: (patch) => {
    set((s) => {
      const next = { ...s.settings, ...patch };
      lsSet(LS_KEYS.settings, next);
      return { settings: next };
    });
  },

  setManagerUnlocked: (ok) => {
    set({ managerUnlocked: ok });
    if (ok) lsSet(LS_KEYS.managerOk, true);
  },

  refreshVerdict: () => {
    const { model, features, verdict: prev, scenario } = get();
    if (!model) return;
    const v = classify(model, features);
    set({ verdict: v });
    set((s) => ({
      plan:
        scenario === 'blackout'
          ? blackoutPlan()
          : !prev || prev.class !== v.class
            ? planFor(v.class, features)
            : s.plan,
    }));
    if (prev && prev.class !== v.class) {
      get().logEvent(
        'dpi',
        v.class === 'benign' ? 'ok' : 'warn',
        `DPI verdict changed → ${v.class.toUpperCase()} (conf ${(v.confidence * 100).toFixed(1)}%) — countermeasure plan recomputed`,
      );
    }
  },
}));

/* ------------------------------------------------------------------ */
/* 1 Hz engine loop                                                    */
/* ------------------------------------------------------------------ */

let tickTimer: ReturnType<typeof setInterval> | null = null;

export function startEngine(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const s = useVor.getState();
    // Telemetry — only while connected.
    if (s.tunnel === 'connected') {
      const cms = new Set(s.activeCms);
      const point = stepTelemetry(s.telemetry, {
        scenario: s.scenario,
        connected: true,
        countermeasures: cms,
        mtu: s.settings.mtu,
      });
      useVor.setState((st) => ({
        telemetry: point,
        transferredMB: st.transferredMB + (point.down + point.up) / 8,
        series: {
          down: pushSeries(st.series.down, point.down),
          up: pushSeries(st.series.up, point.up),
          latency: pushSeries(st.series.latency, point.latency),
          jitter: pushSeries(st.series.jitter, point.jitter),
          loss: pushSeries(st.series.loss, point.loss),
        },
      }));
      // Active-DPI RST injection forces reconnect bursts when undefended.
      if (s.scenario === 'active_dpi' && !cms.has('client_hello_split') && Math.random() < 0.07) {
        useVor.getState().logEvent('ids', 'error', 'injected TCP RST on tunnel socket — auto-reconnect engaged');
        useVor.setState({ tunnel: 'reconnecting' });
        setTimeout(() => {
          const cur = useVor.getState();
          if (cur.tunnel === 'reconnecting') {
            useVor.setState({ tunnel: 'connected' });
            cur.logEvent('controller', 'ok', 'session re-keyed after RST burst — backhaul restored');
          }
        }, 1500);
      }
    }
    // DPI feature trajectory + inference (always live so the Defense tab breathes).
    if (!useVor.getState().manualOverride) {
      const nextFeatures = stepFeatures(useVor.getState().features, useVor.getState().scenario);
      const cms = new Set(useVor.getState().activeCms);
      // Countermeasures visibly repair the channel (closed loop).
      if (cms.has('client_hello_split') || cms.has('fake_sni')) nextFeatures.reset_after_client_hello *= 0.55;
      if (cms.has('packet_fragmentation')) nextFeatures.rst_rate *= 0.55;
      if (cms.has('fake_sni')) nextFeatures.rst_rate *= 0.7;
      if (cms.has('utls_fingerprint')) nextFeatures.probe_hit_rate *= 0.6;
      if (cms.has('mux')) nextFeatures.throttle_ratio *= 0.78;
      if (cms.has('port_hopping')) {
        nextFeatures.throttle_ratio *= 0.72;
        nextFeatures.rtt_variance *= 0.9;
      }
      if (cms.has('padding')) nextFeatures.timing_regularity *= 0.6;
      if (cms.has('dns_mode') || cms.has('transport_switch')) nextFeatures.handshake_fail_ratio *= 0.55;
      useVor.setState({ features: nextFeatures });
    }
    useVor.getState().refreshVerdict();
  }, 1000);
}

export function stopEngine(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export function t(lang: Lang): (key: string) => string {
  return (key: string) => tt(lang, key);
}
