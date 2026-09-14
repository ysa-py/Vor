/**
 * DPI neural classifier — exact TS mirror of vor-engine dpi/model.rs.
 *
 * Forward pass: 8 → 16 (ReLU) → 8 (ReLU) → 3 (softmax), weights loaded at
 * runtime from the static model manifest (same file the Rust client ships).
 */

export interface DpiFeatures {
  rtt_variance: number;
  rst_rate: number;
  handshake_fail_ratio: number;
  reset_after_client_hello: number;
  payload_entropy: number;
  timing_regularity: number;
  throttle_ratio: number;
  probe_hit_rate: number;
}

export const FEATURE_ORDER: (keyof DpiFeatures)[] = [
  'rtt_variance',
  'rst_rate',
  'handshake_fail_ratio',
  'reset_after_client_hello',
  'payload_entropy',
  'timing_regularity',
  'throttle_ratio',
  'probe_hit_rate',
];

export const FEATURE_LABELS_FA: Record<keyof DpiFeatures, string> = {
  rtt_variance: 'واریانس تأخیر (RTT)',
  rst_rate: 'نرخ TCP RST',
  handshake_fail_ratio: 'نسبت شکست Handshake',
  reset_after_client_hello: 'RST پس از ClientHello',
  payload_entropy: 'آنتروپی Payload',
  timing_regularity: 'منظم بودن زمان‌بندی',
  throttle_ratio: 'نسبت محدودسازی پهنای باند',
  probe_hit_rate: 'نرخ برخورد Probe فعال',
};

export const FEATURE_LABELS_EN: Record<keyof DpiFeatures, string> = {
  rtt_variance: 'RTT Variance',
  rst_rate: 'TCP RST Rate',
  handshake_fail_ratio: 'Handshake Fail Ratio',
  reset_after_client_hello: 'RST after ClientHello',
  payload_entropy: 'Payload Entropy',
  timing_regularity: 'Timing Regularity',
  throttle_ratio: 'Throttle Ratio',
  probe_hit_rate: 'Probe Hit Rate',
};

export type DpiClass = 'benign' | 'throttling' | 'active_dpi';

export interface ModelManifest {
  model: string;
  version: string;
  architecture: number[];
  activations: string[];
  classes: DpiClass[];
  features: string[];
  val_accuracy: number;
  weights: {
    W1: number[][]; // 16 x 8
    b1: number[]; // 16
    W2: number[][]; // 8 x 16
    b2: number[]; // 8
    W3: number[][]; // 3 x 8
    b3: number[]; // 3
  };
}

export interface DpiVerdict {
  class: DpiClass;
  confidence: number;
  probs: [number, number, number];
  model_version: string;
  train_accuracy: number;
}

/** Clamp defensively — malformed telemetry must never poison inference. */
export function sanitizeFeatures(f: DpiFeatures): DpiFeatures {
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  return {
    rtt_variance: cl(f.rtt_variance),
    rst_rate: cl(f.rst_rate),
    handshake_fail_ratio: cl(f.handshake_fail_ratio),
    reset_after_client_hello: cl(f.reset_after_client_hello),
    payload_entropy: cl(f.payload_entropy),
    timing_regularity: cl(f.timing_regularity),
    throttle_ratio: cl(f.throttle_ratio),
    probe_hit_rate: cl(f.probe_hit_rate),
  };
}

export function featuresToArray(f: DpiFeatures): number[] {
  return FEATURE_ORDER.map((k) => f[k]);
}

/** Genuine inference — same math as model.rs and the numpy training script. */
export function classify(model: ModelManifest, rawFeatures: DpiFeatures): DpiVerdict {
  const x = featuresToArray(sanitizeFeatures(rawFeatures));
  const { W1, b1, W2, b2, W3, b3 } = model.weights;

  const h1: number[] = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    let acc = b1[i];
    const row = W1[i];
    for (let j = 0; j < 8; j++) acc += row[j] * x[j];
    h1[i] = acc > 0 ? acc : 0;
  }

  const h2: number[] = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    let acc = b2[i];
    const row = W2[i];
    for (let j = 0; j < 16; j++) acc += row[j] * h1[j];
    h2[i] = acc > 0 ? acc : 0;
  }

  const logits: number[] = new Array(3).fill(0);
  for (let i = 0; i < 3; i++) {
    let acc = b3[i];
    const row = W3[i];
    for (let j = 0; j < 8; j++) acc += row[j] * h2[j];
    logits[i] = acc;
  }

  // Numerically stable softmax.
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum) as [number, number, number];

  let best = 0;
  for (let i = 1; i < 3; i++) if (probs[i] > probs[best]) best = i;

  return {
    class: model.classes[best] ?? 'benign',
    confidence: probs[best],
    probs,
    model_version: model.version,
    train_accuracy: model.val_accuracy,
  };
}

/* ------------------------------------------------------------------ */
/* Countermeasures (mirror countermeasures.rs plan_for)                */
/* ------------------------------------------------------------------ */

export type CountermeasureKind =
  | { kind: 'client_hello_split'; at_byte: number }
  | { kind: 'packet_fragmentation'; mss: number }
  | { kind: 'utls_fingerprint'; profile: string }
  | { kind: 'fake_sni'; front_domain: string }
  | { kind: 'padding'; bytes: number }
  | { kind: 'mux'; max_concurrency: number }
  | { kind: 'port_hopping'; interval_secs: number; range: string }
  | { kind: 'dns_mode'; mode: 'domestic_direct' | 'dot' | 'doh' | 'bootstrap_ips' }
  | { kind: 'transport_switch'; to: string }
  | { kind: 'blackout_mode' };

export interface CountermeasurePlan {
  triggered_by: DpiClass | 'blackout';
  actions: CountermeasureKind[];
  explanations: string[];
}

export function cmLabel(a: CountermeasureKind): string {
  switch (a.kind) {
    case 'client_hello_split':
      return `ClientHello Split @${a.at_byte}`;
    case 'packet_fragmentation':
      return `MSS ${a.mss} Fragmentation`;
    case 'utls_fingerprint':
      return `uTLS ${a.profile}`;
    case 'fake_sni':
      return `Fronted SNI (${a.front_domain})`;
    case 'padding':
      return `Padding +${a.bytes}B`;
    case 'mux':
      return `Xmux ×${a.max_concurrency}`;
    case 'port_hopping':
      return `Port Hopping ${a.range}`;
    case 'dns_mode':
      return `DNS → ${a.mode}`;
    case 'transport_switch':
      return `Transport → ${a.to}`;
    case 'blackout_mode':
      return 'BLACKOUT MODE';
  }
}

export function planFor(cls: DpiClass, rawFeatures: DpiFeatures): CountermeasurePlan {
  const f = sanitizeFeatures(rawFeatures);
  const actions: CountermeasureKind[] = [];
  const explanations: string[] = [];

  if (cls === 'benign') {
    actions.push({ kind: 'utls_fingerprint', profile: 'chrome' });
    explanations.push('channel clean: standard uTLS camouflage only');
  } else if (cls === 'throttling') {
    if (f.timing_regularity > 0.5) {
      actions.push({ kind: 'padding', bytes: 64 });
      explanations.push('periodic shaping detected → payload padding blurs length signature');
    }
    actions.push({ kind: 'mux', max_concurrency: 4 });
    explanations.push('throttle suspected → mux reduces per-flow fingerprints');
    actions.push({ kind: 'port_hopping', interval_secs: 45, range: '10000-20000' });
    explanations.push('rate-limited port profile → port hopping escapes per-port QoS');
  } else {
    actions.push({ kind: 'client_hello_split', at_byte: 7 });
    explanations.push('active SNI inspection → ClientHello split at byte 7 breaks reassembly');
    actions.push({ kind: 'utls_fingerprint', profile: 'randomized' });
    explanations.push('fingerprint pinning detected → randomized uTLS profile');
    actions.push({ kind: 'packet_fragmentation', mss: 48 });
    explanations.push('RST injection pattern → aggressive fragmentation');
    if (f.reset_after_client_hello > 0.4) {
      actions.push({ kind: 'fake_sni', front_domain: 'cdn.jsdelivr.net' });
      explanations.push('SNI-based reset → fronted domain masks the real destination');
    }
    actions.push({ kind: 'transport_switch', to: 'ws_tls_cdn' });
    explanations.push('hostile in-path box → escalate to CDN-routed transport');
  }

  return { triggered_by: cls, actions, explanations };
}

export function blackoutPlan(): CountermeasurePlan {
  return {
    triggered_by: 'blackout',
    actions: [
      { kind: 'blackout_mode' },
      { kind: 'dns_mode', mode: 'bootstrap_ips' },
      { kind: 'client_hello_split', at_byte: 5 },
      { kind: 'packet_fragmentation', mss: 40 },
      { kind: 'transport_switch', to: 'ws_tls_cdn' },
    ],
    explanations: [
      'international blackout detected → CDN-fronted transports only',
      'DNS hard-bootstrap avoids hijacked resolvers',
      'aggressive fragmentation for in-country DPI boxes',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Demo threat scenarios — synthetic feature trajectories              */
/* ------------------------------------------------------------------ */

export type Scenario = 'calm' | 'throttling' | 'active_dpi' | 'blackout';

export const SCENARIO_TARGETS: Record<Scenario, DpiFeatures> = {
  calm: {
    rtt_variance: 0.15,
    rst_rate: 0.05,
    handshake_fail_ratio: 0.08,
    reset_after_client_hello: 0.04,
    payload_entropy: 0.88,
    timing_regularity: 0.12,
    throttle_ratio: 0.08,
    probe_hit_rate: 0.03,
  },
  throttling: {
    rtt_variance: 0.45,
    rst_rate: 0.2,
    handshake_fail_ratio: 0.25,
    reset_after_client_hello: 0.14,
    payload_entropy: 0.55,
    timing_regularity: 0.78,
    throttle_ratio: 0.72,
    probe_hit_rate: 0.1,
  },
  active_dpi: {
    rtt_variance: 0.7,
    rst_rate: 0.68,
    handshake_fail_ratio: 0.62,
    reset_after_client_hello: 0.72,
    payload_entropy: 0.24,
    timing_regularity: 0.44,
    throttle_ratio: 0.3,
    probe_hit_rate: 0.66,
  },
  blackout: {
    rtt_variance: 0.9,
    rst_rate: 0.5,
    handshake_fail_ratio: 0.85,
    reset_after_client_hello: 0.45,
    payload_entropy: 0.12,
    timing_regularity: 0.3,
    throttle_ratio: 0.85,
    probe_hit_rate: 0.2,
  },
};

/** Move features one tick toward the scenario target (organic noise). */
export function stepFeatures(current: DpiFeatures, scenario: Scenario, noise = 0.035): DpiFeatures {
  const target = SCENARIO_TARGETS[scenario];
  const next = { ...current };
  for (const k of FEATURE_ORDER) {
    const t = target[k];
    const cur = current[k];
    next[k] = cur + (t - cur) * 0.22 + (Math.random() - 0.5) * 2 * noise;
    next[k] = Math.min(1, Math.max(0, next[k]));
  }
  return next;
}

export const ZERO_FEATURES: DpiFeatures = {
  rtt_variance: 0,
  rst_rate: 0,
  handshake_fail_ratio: 0,
  reset_after_client_hello: 0,
  payload_entropy: 0.9,
  timing_regularity: 0.1,
  throttle_ratio: 0,
  probe_hit_rate: 0,
};

export async function loadModelManifest(): Promise<ModelManifest> {
  const res = await fetch('/model/model_manifest.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error(`model manifest fetch failed: ${res.status}`);
  const json = (await res.json()) as ModelManifest;
  if (!json?.weights?.W1 || json.architecture.join(',') !== '8,16,8,3') {
    throw new Error('model manifest architecture mismatch');
  }
  return json;
}
