/**
 * Keystore & trusted-key management — mirror of vor-license keys.rs.
 *
 * Manager side: Ed25519 signing keystore persisted in localStorage.
 * Client side: trusted public-key snapshot auto-synced from the manager
 * (in the production build these are separate hosts; the demo shares a
 * browser profile).
 */
import {
  DEFAULT_CLOCK_SKEW_SECS,
  FORMAT_VERSION,
  LicenseError,
  LicensePayload,
  PRODUCT_ID,
  VerificationReport,
  envelopeDecode,
  envelopeEncode,
  parsePayloadJson,
  payloadToCanonical,
  validateSchema,
  type Entitlement,
  type LicenseTier,
} from './license';
import { canonicalJson } from './canonical';
import { ed25519, fromHex, sha256Hex, toHex, utf8 } from './crypto';
import { normalizeHwid } from './hwid';

export type KeyStatus = 'active' | 'retired';

export interface KeyRecord {
  key_id: string;
  public: string; // hex
  status: KeyStatus;
  created_at: number;
  note: string;
}

export interface KeyStore {
  keystore_version: number;
  signing_key: string; // hex(32)
  active_key_id: string;
  keys: Record<string, KeyRecord>;
}

export interface TrustedKeys {
  trusted_version: number;
  keys: Record<string, KeyRecord>;
}

/** Deterministic key id: VLA-<first 16 hex chars of SHA-256(pubkey)> (keys.rs). */
export function deriveKeyId(publicKey: Uint8Array): string {
  return `VLA-${sha256Hex(publicKey).slice(0, 16)}`;
}

/* ------------------------------------------------------------------ */
/* Keystore operations                                                 */
/* ------------------------------------------------------------------ */

export function generateKeystore(now: number): KeyStore {
  const kp = ed25519.keygen();
  const keyId = deriveKeyId(kp.publicKey);
  const ks: KeyStore = {
    keystore_version: 1,
    signing_key: toHex(kp.secretKey),
    active_key_id: keyId,
    keys: {
      [keyId]: {
        key_id: keyId,
        public: toHex(kp.publicKey),
        status: 'active',
        created_at: now,
        note: 'master key',
      },
    },
  };
  return ks;
}

export function rotateKeystore(ks: KeyStore, now: number, retireOld: boolean): KeyStore {
  const next: KeyStore = {
    ...ks,
    keys: Object.fromEntries(
      Object.entries(ks.keys).map(([k, v]) => [
        k,
        retireOld && v.status === 'active'
          ? { ...v, status: 'retired' as KeyStatus, note: `${v.note} (retired at rotation ${now})` }
          : { ...v },
      ]),
    ),
  };
  const kp = ed25519.keygen();
  const keyId = deriveKeyId(kp.publicKey);
  next.keys[keyId] = {
    key_id: keyId,
    public: toHex(kp.publicKey),
    status: 'active',
    created_at: now,
    note: 'rotated master key',
  };
  next.signing_key = toHex(kp.secretKey);
  next.active_key_id = keyId;
  return next;
}

export function activeKeyOf(ks: KeyStore | null): KeyRecord | null {
  if (!ks) return null;
  return ks.keys[ks.active_key_id] ?? null;
}

export function trustedFromKeystore(ks: KeyStore): TrustedKeys {
  return { trusted_version: 1, keys: { ...ks.keys } };
}

export function isTrusted(trusted: TrustedKeys | null, keyId: string): boolean {
  return trusted?.keys[keyId]?.status === 'active';
}

export function signCanonical(ks: KeyStore, canonical: string): Uint8Array {
  const sk = fromHex(ks.signing_key);
  return ed25519.sign(utf8(canonical), sk);
}

/* ------------------------------------------------------------------ */
/* Issue (mirror issue.rs)                                             */
/* ------------------------------------------------------------------ */

export interface IssuedLicense {
  envelope: string;
  file: string; // pretty JSON of the .vorlic document
  payload: LicensePayload;
}

export function issueLicense(ks: KeyStore, payload: LicensePayload): IssuedLicense {
  validateSchema(payload);
  if (payload.key_id !== ks.active_key_id) {
    throw new LicenseError(
      'E_INVALID_FIELD',
      'invalid field value: key_id: payload key_id does not match active keystore key',
    );
  }
  const canonical = payloadToCanonical(payload);
  const signature = signCanonical(ks, canonical);
  const pk = fromHex(activeKeyOf(ks)?.public ?? '');
  const envelope = envelopeEncode(canonical, signature, pk);
  const file = JSON.stringify(
    { format: 'VORLIC', version: FORMAT_VERSION, envelope },
    null,
    2,
  );
  return { envelope, file, payload };
}

export function buildPayload(opts: {
  now: number;
  days: number;
  keyId: string;
  tier: LicenseTier;
  entitlements: Entitlement[];
  maxDevices: number;
  boundHwids: string[];
  metadata?: string;
  licenseId?: string;
  notBefore?: number;
}): LicensePayload {
  const nb = opts.notBefore ?? opts.now;
  return {
    license_version: FORMAT_VERSION,
    license_id: opts.licenseId ?? crypto.randomUUID(),
    product: PRODUCT_ID,
    key_id: opts.keyId,
    issued_at: opts.now,
    not_before: nb,
    expires_at: nb + Math.round(opts.days * 86_400),
    license_tier: opts.tier,
    entitlements: opts.entitlements,
    device_policy: {
      max_devices: opts.maxDevices,
      bound_hwids: opts.boundHwids.map(normalizeHwid),
    },
    metadata: opts.metadata?.trim() ? opts.metadata.trim() : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Verify (exact order of verify.rs — fail-closed)                     */
/* ------------------------------------------------------------------ */

export interface VerifyOptions {
  now: number;
  clockSkewSecs?: number;
  deviceHwid?: string | null;
  revoked?: Set<string> | string[];
}

export function verifyLicense(
  envelope: string,
  trusted: TrustedKeys | null,
  opts: VerifyOptions,
): LicensePayload {
  // 1) Parse envelope ------------------------------------------------------
  const { payloadJson, sig, pk } = envelopeDecode(envelope);

  // 2) Payload structure + schema ------------------------------------------
  const payload = parsePayloadJson(payloadJson);
  validateSchema(payload);

  // 3) Signature byte integrity --------------------------------------------
  if (sig.length !== 64) {
    throw new LicenseError('E_MALFORMED', 'malformed license input: signature must be 64 bytes');
  }

  // 4) Trust: embedded pubkey must hash to the declared key_id AND be trusted.
  if (pk.length !== 32) {
    throw new LicenseError('E_MALFORMED', 'malformed license input: public key must be 32 bytes');
  }
  const derivedId = deriveKeyId(pk);
  if (derivedId !== payload.key_id) {
    throw new LicenseError(
      'E_MALFORMED',
      'malformed license input: embedded public key does not match declared key_id',
    );
  }
  if (!isTrusted(trusted, payload.key_id)) {
    throw new LicenseError('E_UNTRUSTED_KEY', `signing key is not trusted (key_id=${payload.key_id})`);
  }

  // 5) Cryptographic authority — signature over the CANONICAL payload bytes.
  const canonical = canonicalJson(JSON.parse(payloadJson));
  const ok = ed25519.verify(sig, utf8(canonical), pk);
  if (!ok) {
    throw new LicenseError('E_SIGNATURE', 'signature verification failed');
  }

  // 6) Time window (with bounded skew tolerance) ---------------------------
  const skew = Math.max(0, opts.clockSkewSecs ?? DEFAULT_CLOCK_SKEW_SECS);
  if (opts.now < payload.not_before - skew) {
    throw new LicenseError(
      'E_NOT_YET_VALID',
      `license is not valid before ${new Date(payload.not_before * 1000).toISOString()}`,
    );
  }
  if (opts.now > payload.expires_at + skew) {
    throw new LicenseError(
      'E_EXPIRED',
      `license expired at ${new Date(payload.expires_at * 1000).toISOString()}`,
    );
  }

  // 7) Entitlements are schema-validated above (unknown values fail).

  // 8) Device policy --------------------------------------------------------
  if (payload.device_policy.bound_hwids.length > 0) {
    if (!opts.deviceHwid) {
      throw new LicenseError('E_DEVICE', 'device not licensed (HWID mismatch)');
    }
    const hw = normalizeHwid(opts.deviceHwid);
    const bound = new Set(payload.device_policy.bound_hwids.map(normalizeHwid));
    if (!bound.has(hw)) {
      throw new LicenseError('E_DEVICE', 'device not licensed (HWID mismatch)');
    }
  }

  // 9) Local revocation -------------------------------------------------------
  const revoked = opts.revoked ?? [];
  if (Array.isArray(revoked) ? revoked.includes(payload.license_id) : revoked.has(payload.license_id)) {
    throw new LicenseError('E_REVOKED', 'license has been locally revoked');
  }

  return payload;
}

export function verifyToReport(
  envelope: string,
  trusted: TrustedKeys | null,
  opts: VerifyOptions,
): VerificationReport {
  try {
    const p = verifyLicense(envelope, trusted, opts);
    return {
      ok: true,
      license_id: p.license_id,
      tier: p.license_tier,
      key_id: p.key_id,
      expires_at: p.expires_at,
      days_remaining: Math.max(0, Math.floor((p.expires_at - opts.now) / 86_400)),
      entitlements: p.entitlements,
    };
  } catch (e) {
    if (e instanceof LicenseError) {
      return { ok: false, error_code: e.code, error: e.message };
    }
    return { ok: false, error_code: 'E_MALFORMED', error: String(e) };
  }
}
