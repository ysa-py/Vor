/**
 * Tunnel engine logic — mirrors vor-engine scoring.rs + controller.rs.
 * Deterministic, explainable endpoint scoring with the exact same weights.
 */
import type { Scenario } from './dpi';

export type TransportClass =
  | 'reality_direct'
  | 'ws_tls_cdn'
  | 'grpc_tls'
  | 'httpupgrade_cdn'
  | 'ss2022';

export const TRANSPORT_LADDER: TransportClass[] = [
  'reality_direct',
  'ws_tls_cdn',
  'grpc_tls',
  'httpupgrade_cdn',
  'ss2022',
];

export const TRANSPORT_LABELS: Record<TransportClass, string> = {
  reality_direct: 'VLESS + Reality + uTLS',
  ws_tls_cdn: 'VLESS + WS + TLS (CDN)',
  grpc_tls: 'gRPC + TLS (mux)',
  httpupgrade_cdn: 'HTTPUpgrade + TLS (CDN)',
  ss2022: 'Shadowsocks-2022 (AEAD)',
};

export interface EndpointHealth {
  endpoint_id: string;
  latencies: number[];
  loss_pct: number;
  fail_streak: number;
  cdn_routed: boolean;
  label: string;
  region: string;
}

export function meanLatency(h: EndpointHealth): number {
  if (h.latencies.length === 0) return 0;
  return h.latencies.reduce((a, b) => a + b, 0) / h.latencies.length;
}

export function jitterOf(h: EndpointHealth): number {
  if (h.latencies.length < 2) return 0;
  let maxDiff = 0;
  for (let i = 1; i < h.latencies.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(h.latencies[i] - h.latencies[i - 1]));
  }
  return maxDiff;
}

/* ------------------------------------------------------------------ */
/* Scoring (mirror scoring.rs)                                          */
/* ------------------------------------------------------------------ */

const W_LATENCY = 0.4;
const W_JITTER = 0.15;
const W_LOSS = 0.25;
const W_STABILITY = 0.2;

export interface DecisionExplanation {
  endpoint_id: string;
  transport: TransportClass;
  score: number;
  reasons: string[];
  components: { latency: number; jitter: number; loss: number; stability: number };
}

export function scoreEndpoint(h: EndpointHealth, transport: TransportClass): DecisionExplanation {
  const lat = meanLatency(h);
  const jit = jitterOf(h);

  // Latency component: 30ms→1.0, 300ms→0.33, 1000ms+→~0.1
  const latScore = 1.0 / (1.0 + lat / 200.0);
  const jitScore = 1.0 / (1.0 + jit / 40.0);
  const lossScore = Math.min(1, Math.max(0, 1.0 - h.loss_pct / 100.0));
  const stability = h.fail_streak === 0 ? 1.0 : Math.max(0, 1.0 - h.fail_streak * 0.25);

  let score =
    100.0 *
    (W_LATENCY * latScore + W_JITTER * jitScore + W_LOSS * lossScore + W_STABILITY * stability);

  const reasons: string[] = [];
  if (lat < 80) reasons.push(`latency ${lat.toFixed(0)}ms (excellent)`);
  else if (lat < 200) reasons.push(`latency ${lat.toFixed(0)}ms (acceptable)`);
  else {
    reasons.push(`latency ${lat.toFixed(0)}ms (poor, penalized)`);
    score *= 0.9;
  }
  if (h.fail_streak >= 2) {
    reasons.push(`${h.fail_streak} consecutive failures, penalized`);
    score -= 10.0 * Math.min(5, h.fail_streak);
  }
  if (h.cdn_routed) {
    reasons.push('CDN-routed: resilient to international blackouts');
    score *= 1.05;
  }
  reasons.push(`loss ${h.loss_pct.toFixed(1)}%, jitter ${jit.toFixed(1)}ms`);

  return {
    endpoint_id: h.endpoint_id,
    transport,
    score: Math.min(100, Math.max(0, score)),
    reasons,
    components: { latency: latScore, jitter: jitScore, loss: lossScore, stability },
  };
}

export function pickBest(
  candidates: { health: EndpointHealth; transport: TransportClass }[],
): DecisionExplanation | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => scoreEndpoint(c.health, c.transport));
  scored.sort((a, b) => b.score - a.score || a.endpoint_id.localeCompare(b.endpoint_id));
  return scored[0];
}

/* ------------------------------------------------------------------ */
/* Demo fleet                                                          */
/* ------------------------------------------------------------------ */

export const BASE_ENDPOINTS: EndpointHealth[] = [
  {
    endpoint_id: 'fra-04',
    label: 'Frankfurt (FRA-04)',
    region: 'DE • Hetzner vault',
    latencies: [18, 19, 17, 18],
    loss_pct: 0,
    fail_streak: 0,
    cdn_routed: false,
  },
  {
    endpoint_id: 'ams-02',
    label: 'Amsterdam (AMS-02)',
    region: 'NL • sovereign mesh',
    latencies: [34, 36, 33, 35],
    loss_pct: 0.1,
    fail_streak: 0,
    cdn_routed: false,
  },
  {
    endpoint_id: 'cdn-ist-01',
    label: 'CDN Tehran Edge (IST-01)',
    region: 'IR • CDN-fronted',
    latencies: [58, 61, 55, 60],
    loss_pct: 0.4,
    fail_streak: 0,
    cdn_routed: true,
  },
  {
    endpoint_id: 'sg-01',
    label: 'Singapore (SG-01)',
    region: 'SG • pacific relay',
    latencies: [142, 150, 138, 147],
    loss_pct: 1.2,
    fail_streak: 0,
    cdn_routed: false,
  },
];

/* ------------------------------------------------------------------ */
/* State machine (controller.rs parity)                                 */
/* ------------------------------------------------------------------ */

export type TunnelState =
  | 'idle'
  | 'preparing'
  | 'checking_network'
  | 'selecting_transport'
  | 'connecting'
  | 'handshake'
  | 'connected'
  | 'reconnecting'
  | 'switching_transport'
  | 'diagnosing'
  | 'license_required'
  | 'license_expired'
  | 'config_error';

export const MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8000;

export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.min(4, attempt)));
}

export interface TelemetryPoint {
  down: number; // Mbps
  up: number; // Mbps
  latency: number; // ms
  jitter: number; // ms
  loss: number; // %
}

export const SERIES_LEN = 48;

export function initialTelemetry(): TelemetryPoint {
  return { down: 0, up: 0, latency: 0, jitter: 0, loss: 0 };
}

/**
 * One telemetry tick — a plausible random walk around scenario-modulated
 * baselines. Active countermeasures visibly repair the stream (closed loop).
 */
export function stepTelemetry(
  prev: TelemetryBase,
  opts: { scenario: Scenario; connected: boolean; countermeasures: Set<string>; mtu: number },
): TelemetryPoint {
  const { scenario, connected, countermeasures } = opts;
  if (!connected) return { down: 0, up: 0, latency: 0, jitter: 0, loss: 0 };

  let baseDown = 138;
  let baseLat = 18;
  let baseLoss = 0;
  let baseRstJitter = 0.6;

  if (scenario === 'throttling') {
    baseDown = countermeasures.has('mux') || countermeasures.has('port_hopping') ? 78 : 26;
    baseLat = 64;
    baseLoss = countermeasures.has('padding') ? 0.2 : 0.8;
  } else if (scenario === 'active_dpi') {
    baseDown = countermeasures.has('transport_switch') ? 96 : 34;
    baseLat = countermeasures.has('client_hello_split') ? 42 : 96;
    baseLoss = countermeasures.has('packet_fragmentation') ? 0.6 : 4.2;
    baseRstJitter = countermeasures.has('fake_sni') ? 1.4 : 6.5;
  } else if (scenario === 'blackout') {
    baseDown = countermeasures.has('transport_switch') ? 42 : 6;
    baseLat = countermeasures.has('dns_mode') ? 88 : 190;
    baseLoss = countermeasures.has('packet_fragmentation') ? 1.4 : 9;
    baseRstJitter = 5;
  }

  // MTU discipline improves efficiency slightly.
  const mtuFactor = 1 + (opts.mtu - 1420) / 14200;
  const walk = (v: number, amt: number) => v + (Math.random() - 0.5) * 2 * amt;

  const down = Math.max(0.4, walk(baseDown * mtuFactor, baseDown * 0.06));
  const up = Math.max(0.2, walk(down * 0.34, down * 0.05));
  const latency = Math.max(6, walk(baseLat, Math.max(1.2, baseLat * 0.08)));
  const jitter = Math.max(0.1, walk(baseRstJitter, 0.4));
  const loss = Math.min(30, Math.max(0, walk(baseLoss, baseLoss * 0.3 + 0.05)));

  return {
    down: round1(down),
    up: round1(up),
    latency: Math.round(latency * 10) / 10,
    jitter: Math.round(jitter * 10) / 10,
    loss: Math.round(loss * 100) / 100,
  };
}

export interface TelemetryBase {
  down: number;
  up: number;
  latency: number;
  jitter: number;
  loss: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
