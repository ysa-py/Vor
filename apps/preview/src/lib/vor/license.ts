/**
 * VOR license format — TS mirror of vor-license format.rs + lib.rs envelope codec.
 * Fail-closed: unknown fields/versions/entitlements are rejected.
 */
import { canonicalJson, type JsonValue } from './canonical';
import { b64urlDecode, b64urlEncode, utf8 } from './crypto';

export const PRODUCT_ID = 'VOR';
export const FORMAT_VERSION = 2;
export const ENVELOPE_PREFIX = 'VORLIC1';
export const DEFAULT_CLOCK_SKEW_SECS = 300;

export type LicenseTier = 'standard' | 'pro' | 'enterprise';
export type Entitlement =
  | 'core_tunnel'
  | 'stealth_engine'
  | 'relay_chains'
  | 'unlimited_devices'
  | 'priority_fleet';

export const ALL_ENTITLEMENTS: Entitlement[] = [
  'core_tunnel',
  'stealth_engine',
  'relay_chains',
  'unlimited_devices',
  'priority_fleet',
];

export const ENTITLEMENT_LABELS: Record<Entitlement, string> = {
  core_tunnel: 'Core Tunnel',
  stealth_engine: 'Stealth Engine',
  relay_chains: 'Relay Chains',
  unlimited_devices: 'Unlimited Devices',
  priority_fleet: 'Priority Fleet',
};

export interface DevicePolicy {
  max_devices: number;
  bound_hwids: string[];
}

export interface LicensePayload {
  license_version: number;
  license_id: string;
  product: string;
  key_id: string;
  issued_at: number;
  not_before: number;
  expires_at: number;
  license_tier: LicenseTier;
  entitlements: Entitlement[];
  device_policy: DevicePolicy;
  metadata?: string | null;
}

export interface LicenseFile {
  format: 'VORLIC';
  version: 2;
  envelope: string;
}

/* ------------------------------------------------------------------ */
/* Envelope codec (mirrors lib.rs envelope_encode/decode)              */
/* ------------------------------------------------------------------ */

export function envelopeEncode(
  payloadCanonical: string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): string {
  return [
    ENVELOPE_PREFIX,
    b64urlEncode(utf8(payloadCanonical)),
    b64urlEncode(signature),
    b64urlEncode(publicKey),
  ].join('.');
}

export interface EnvelopeParts {
  payloadJson: string;
  sig: Uint8Array;
  pk: Uint8Array;
}

export function envelopeDecode(envelope: string): EnvelopeParts {
  const parts = envelope.trim().split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new LicenseError('E_MALFORMED', 'malformed license input: envelope structure');
  }
  let payloadBytes: Uint8Array;
  let sig: Uint8Array;
  let pk: Uint8Array;
  try {
    payloadBytes = b64urlDecode(parts[1]);
    sig = b64urlDecode(parts[2]);
    pk = b64urlDecode(parts[3]);
  } catch {
    throw new LicenseError('E_MALFORMED', 'malformed license input: base64');
  }
  let payloadJson: string;
  try {
    payloadJson = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch {
    throw new LicenseError('E_MALFORMED', 'malformed license input: payload utf8');
  }
  return { payloadJson, sig, pk };
}

/** Parse an uploaded .vorlic file document → envelope. */
export function parseLicenseFileText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith(ENVELOPE_PREFIX + '.')) return trimmed;
  const doc = JSON.parse(trimmed) as { format?: string; envelope?: string };
  if (doc?.format === 'VORLIC' && typeof doc.envelope === 'string') return doc.envelope;
  if (typeof doc?.envelope === 'string') return doc.envelope;
  throw new LicenseError('E_MALFORMED', 'malformed license input: not a .vorlic document');
}

/* ------------------------------------------------------------------ */
/* Typed errors (mirror error.rs codes)                                */
/* ------------------------------------------------------------------ */

export class LicenseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Schema validation (mirror of LicensePayload::validate_schema)        */
/* ------------------------------------------------------------------ */

const HEX64 = /^[0-9a-fA-F]{64}$/;

export function validateSchema(p: LicensePayload): void {
  if (p.license_version !== FORMAT_VERSION) {
    throw new LicenseError('E_SCHEMA', `unsupported license schema version: ${p.license_version}`);
  }
  if (!p.license_id || !p.license_id.trim()) {
    throw new LicenseError('E_MISSING_FIELD', 'missing required field: license_id');
  }
  if (!p.key_id || !p.key_id.trim()) {
    throw new LicenseError('E_MISSING_FIELD', 'missing required field: key_id');
  }
  if (p.product !== PRODUCT_ID) {
    throw new LicenseError(
      'E_PRODUCT',
      `license is bound to product '${PRODUCT_ID}' but found '${p.product}'`,
    );
  }
  if (p.expires_at <= p.not_before) {
    throw new LicenseError(
      'E_INVALID_FIELD',
      'invalid field value: expires_at: expires_at must be after not_before',
    );
  }
  if (p.issued_at > p.expires_at) {
    throw new LicenseError(
      'E_INVALID_FIELD',
      'invalid field value: issued_at: issued_at cannot be after expiration',
    );
  }
  if (!Array.isArray(p.entitlements) || p.entitlements.length === 0) {
    throw new LicenseError('E_MISSING_FIELD', 'missing required field: entitlements');
  }
  const known = new Set<string>(ALL_ENTITLEMENTS);
  for (const e of p.entitlements) {
    if (!known.has(e)) {
      throw new LicenseError('E_ENTITLEMENT', `unknown entitlement: ${String(e)}`);
    }
  }
  if (!['standard', 'pro', 'enterprise'].includes(p.license_tier)) {
    throw new LicenseError('E_INVALID_FIELD', 'invalid field value: license_tier');
  }
  for (const hw of p.device_policy?.bound_hwids ?? []) {
    const clean = hw.trim().toLowerCase();
    const hexpart = clean.startsWith('hwid-sha256-') ? clean.slice('hwid-sha256-'.length) : clean;
    if (hexpart.length !== 64 || !HEX64.test(hexpart)) {
      throw new LicenseError(
        'E_INVALID_FIELD',
        `invalid field value: device_policy.bound_hwids: invalid HWID format: ${hw}`,
      );
    }
  }
}

/** Parse payload JSON into a typed LicensePayload (defensive). */
export function parsePayloadJson(json: string): LicensePayload {
  let raw: JsonValue;
  try {
    raw = JSON.parse(json) as JsonValue;
  } catch (e) {
    throw new LicenseError('E_MALFORMED', `malformed license input: payload json: ${String(e)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LicenseError('E_MALFORMED', 'malformed license input: payload must be an object');
  }
  const o = raw as Record<string, JsonValue>;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const num = (k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : NaN);
  const p: LicensePayload = {
    license_version: num('license_version'),
    license_id: str('license_id'),
    product: str('product'),
    key_id: str('key_id'),
    issued_at: num('issued_at'),
    not_before: num('not_before'),
    expires_at: num('expires_at'),
    license_tier: str('license_tier') as LicenseTier,
    entitlements: Array.isArray(o.entitlements) ? (o.entitlements as Entitlement[]) : [],
    device_policy:
      o.device_policy && typeof o.device_policy === 'object'
        ? {
            max_devices:
              typeof (o.device_policy as Record<string, JsonValue>).max_devices === 'number'
                ? ((o.device_policy as Record<string, JsonValue>).max_devices as number)
                : 0,
            bound_hwids: Array.isArray((o.device_policy as Record<string, JsonValue>).bound_hwids)
              ? ((o.device_policy as Record<string, JsonValue>).bound_hwids as string[])
              : [],
          }
        : { max_devices: 0, bound_hwids: [] },
  };
  if (o.metadata !== undefined) p.metadata = typeof o.metadata === 'string' ? o.metadata : null;
  return p;
}

/* ------------------------------------------------------------------ */
/* Verification report (mirror verify.rs VerificationReport)           */
/* ------------------------------------------------------------------ */

export interface VerificationReport {
  ok: boolean;
  error_code?: string;
  error?: string;
  license_id?: string;
  tier?: LicenseTier;
  key_id?: string;
  expires_at?: number;
  days_remaining?: number;
  entitlements?: Entitlement[];
}

/* ------------------------------------------------------------------ */
/* Canonical payload helpers                                           */
/* ------------------------------------------------------------------ */

export function payloadToCanonical(p: LicensePayload): string {
  const v: JsonValue = {
    license_version: p.license_version,
    license_id: p.license_id,
    product: p.product,
    key_id: p.key_id,
    issued_at: p.issued_at,
    not_before: p.not_before,
    expires_at: p.expires_at,
    license_tier: p.license_tier,
    entitlements: p.entitlements as JsonValue,
    device_policy: {
      max_devices: p.device_policy.max_devices,
      bound_hwids: p.device_policy.bound_hwids as JsonValue,
    },
  };
  if (p.metadata !== undefined && p.metadata !== null && p.metadata !== '') {
    (v as Record<string, JsonValue>).metadata = p.metadata;
  }
  return canonicalJson(v);
}
