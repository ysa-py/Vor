# LICENSE-SYSTEM.md — سیستم لایسنس آفلاین VOR

## Format (VORLIC-V2)

Canonical JSON payload (sorted keys, no whitespace — **the signature covers
exactly these bytes**):

```json
{
  "license_version": 2,
  "license_id": "uuid-v4",
  "product": "VOR",
  "key_id": "VLA-<sha256(pubkey)[0..16hex]>",
  "issued_at": 1700000000,
  "not_before": 1700000000,
  "expires_at": 1730000000,
  "license_tier": "standard|pro|enterprise",
  "entitlements": ["core_tunnel", "stealth_engine", "relay_chains", …],
  "device_policy": { "max_devices": 3, "bound_hwids": ["hwid-sha256-…"] },
  "metadata": "optional operator reference"
}
```

Envelope: `VORLIC1.<b64url(payload)>.<b64url(sig64)>.<b64url(pubkey32)>`

## Verification chain (fail-closed, exact order — `verify.rs`)

1. Parse envelope (structure + base64) → `E_MALFORMED`
2. Schema validation (version/product/window/tier/entitlements/HWID format)
3. Embedded pubkey must hash to declared `key_id`
4. `key_id` must exist in the client's trusted set with status **active**
5. Ed25519 signature over canonical payload → `E_SIGNATURE`
6. Time window with bounded ±300 s skew → `E_EXPIRED` / `E_NOT_YET_VALID`
7. Device policy — normalized HWID must be bound when binding present → `E_DEVICE`
8. Local revocation list → `E_REVOKED`

The gate **never** unlocks on any failure; the client UI cannot be reached
without an activated license (enforced in `VorShell`, not just routing).

## Key management

* Private signing key lives ONLY in the air-gapped Vor License Manager
  (`apps/vor_license_manager`) / `vor-lictool` vault.
* Clients embed the **trusted public-key bundle** (`export-public`).
* Soft rotation: new key signs; old keys stay verifiable.
* Hard rotation (`--retire-old`): retires all others → old licenses fail-closed.
* The embedded pubkey is cross-checked against `key_id` so swapping keys is
  detectable even inside the trusted set.

## Offline guarantees

* Activation, re-verification (every boot), expiry, revocation and audit run
  100% locally — no server, no GitHub, no NTP dependency (bounded skew only).
* The Rust core has zero runtime network dependencies; the FFI surface is pure
  JSON string marshalling.

## Storage

* Client: activation envelope sealed with an HMAC(SHA-256) tag bound to the
  machine HWID (`storage.rs`) in platform secure storage
  (`flutter_secure_storage`: Android Keystore / DPAPI).
* Manager: keystore in secure storage; license list + audit in local prefs.
  Backups of the keystore are explicit operator actions with warnings.

## Tests (real, executed in this workspace)

`cargo test -p vor-license` = **45 tests** (25 unit + 20 integration) covering
the full §40 matrix: valid / invalid-sig / modified-payload / wrong-key /
wrong-product / expired / future / missing-field / malformed / unsupported
schema / invalid entitlement / rotation (soft+hard) / corrupted / HWID
mismatch / revocation / skew bounds / report serialization / audit tampering /
keystore roundtrip / canonical determinism. CLI end-to-end demo additionally
exercised against the real binary.

<div dir="rtl">
<b>فارسی:</b> لایسنس کاملاً آفلاین است؛ امضا با Ed25519، اعتبارسنجی محلی،
محدودسازی سخت‌افزاری (HWID)، انقضا و ابطال محلی، چرخش کلید و دفتر حسابرسی
ضد‌دستکاری. کلید خصوصی هرگز در کلاینت/مخزن/لاگ وجود ندارد.
</div>
