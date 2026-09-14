//! VOR License Core — offline-first, Ed25519-signed licensing.
//!
//! Security model (see docs/LICENSE-SYSTEM.md):
//! * The **private signing key never ships** inside VOR clients. It lives only
//!   inside the air-gapped *Vor License Manager*.
//! * Clients embed a **trusted public-key set** (key rotation supported).
//! * Verification is 100% local: no server, no GitHub, no internet.
//! * Every rejection path is a typed error; fail-closed is mandatory.

pub mod audit;
pub mod canonical;
pub mod error;
pub mod format;
pub mod hwid;
pub mod issue;
pub mod keys;
pub mod storage;
pub mod verify;

pub use audit::{AuditEntry, AuditLog};
pub use error::LicenseError;
pub use format::{DevicePolicy, LicensePayload, LicenseTier, Entitlement, ENVELOPE_PREFIX, FORMAT_VERSION, PRODUCT_ID};
pub use hwid::{machine_hwid, normalize_hwid};
pub use issue::issue_license;
pub use keys::{KeyRecord, KeyStatus, KeyStore, TrustedKeys};
pub use verify::{verify_license, verify_to_report, VerifyOptions, VerificationReport};

/// Canonical string form of a license envelope:
/// `VORLIC1.<b64url(payload)>.<b64url(signature)>.<b64url(public_key)>`
pub fn envelope_encode(payload_canonical: &str, signature: &[u8], public_key: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    format!(
        "{}.{}.{}.{}",
        ENVELOPE_PREFIX,
        b64.encode(payload_canonical.as_bytes()),
        b64.encode(signature),
        b64.encode(public_key)
    )
}

/// Parse an envelope back into (payload_json, signature, public_key).
pub fn envelope_decode(envelope: &str) -> Result<(String, Vec<u8>, Vec<u8>), LicenseError> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let parts: Vec<&str> = envelope.trim().split('.').collect();
    if parts.len() != 4 || parts[0] != ENVELOPE_PREFIX {
        return Err(LicenseError::Malformed("envelope structure".into()));
    }
    let payload = b64
        .decode(parts[1])
        .map_err(|_| LicenseError::Malformed("payload base64".into()))?;
    let sig = b64
        .decode(parts[2])
        .map_err(|_| LicenseError::Malformed("signature base64".into()))?;
    let pk = b64
        .decode(parts[3])
        .map_err(|_| LicenseError::Malformed("public key base64".into()))?;
    let payload_str = String::from_utf8(payload).map_err(|_| LicenseError::Malformed("payload utf8".into()))?;
    Ok((payload_str, sig, pk))
}

/// Generate a fresh RFC-4122 v4 license id from OS entropy (offline-safe).
pub fn new_license_id() -> String {
    use rand_core::RngCore;
    let mut b = [0u8; 16];
    rand_core::OsRng.fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
    let hex = hex::encode(b);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_ids_are_uuid_v4_shaped_and_unique() {
        let a = new_license_id();
        let b = new_license_id();
        assert_ne!(a, b);
        let is_hex = |s: &str| s.bytes().all(|c| c.is_ascii_hexdigit());
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!((parts[0].len(), parts[1].len(), parts[2].len(), parts[3].len(), parts[4].len()),
                   (8, 4, 4, 4, 12));
        assert!(parts.iter().all(|p| is_hex(p)));
        assert!(a[14..15].starts_with('4'));
    }
}
