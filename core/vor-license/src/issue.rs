use ed25519_dalek::Signature;
use serde_json::json;

use crate::canonical::canonical_json;
use crate::error::LicenseError;
use crate::format::{LicenseFile, LicensePayload, FORMAT_VERSION};
use crate::keys::KeyStore;

/// Sign a payload and produce the portable license envelope + `.vorlic` file.
///
/// The signature covers the **canonical JSON** of the payload exactly.
pub fn issue_license(
    keystore: &KeyStore,
    payload: &LicensePayload,
) -> Result<(String, LicenseFile), LicenseError> {
    payload.validate_schema()?;
    if payload.key_id != keystore.active_key_id().unwrap_or_default() {
        // Force the payload to carry the active key id to avoid mismatch.
        return Err(LicenseError::InvalidField {
            field: "key_id".into(),
            reason: "payload key_id does not match active keystore key".into(),
        });
    }
    let payload_value = serde_json::to_value(payload)
        .map_err(|e| LicenseError::Malformed(format!("serialize payload: {e}")))?;
    let canonical = canonical_json(&payload_value);
    let (_key_id, signature): (String, Signature) = keystore.sign(canonical.as_bytes())?;
    let envelope = crate::envelope_encode(
        &canonical,
        &signature.to_bytes(),
        keystore.signing_key.verifying_key().as_bytes(),
    );
    Ok((
        envelope.clone(),
        LicenseFile {
            format: "VORLIC".into(),
            version: FORMAT_VERSION,
            envelope,
        },
    ))
}

/// Convenience JSON descriptor used by the FFI layer and CLI output.
pub fn issue_json(keystore: &KeyStore, payload: &LicensePayload) -> Result<String, LicenseError> {
    let (envelope, file) = issue_license(keystore, payload)?;
    let doc = json!({
        "envelope": envelope,
        "file": file,
        "license_id": payload.license_id,
        "expires_at": payload.expires_at,
        "tier": payload.license_tier.as_str(),
    });
    serde_json::to_string(&doc).map_err(|e| LicenseError::Malformed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::{DevicePolicy, Entitlement, LicenseTier};

    fn payload(now: i64, days: i64, key_id: &str) -> LicensePayload {
        LicensePayload {
            license_version: FORMAT_VERSION,
            license_id: "11111111-2222-4333-8444-555566667777".into(),
            product: crate::format::PRODUCT_ID.into(),
            key_id: key_id.into(),
            issued_at: now,
            not_before: now,
            expires_at: now + days * 86_400,
            license_tier: LicenseTier::Pro,
            entitlements: vec![Entitlement::CoreTunnel, Entitlement::StealthEngine],
            device_policy: DevicePolicy::default(),
            metadata: Some("QA".into()),
        }
    }

    #[test]
    fn issue_produces_verifiable_envelope() {
        let ks = KeyStore::generate(1_700_000_000).unwrap();
        let kid = ks.active_key_id().unwrap();
        let (envelope, file) = issue_license(&ks, &payload(1_700_000_000, 365, &kid)).unwrap();
        assert!(envelope.starts_with("VORLIC1."));
        assert_eq!(file.format, "VORLIC");
        let (payload_json, sig, pk) = crate::envelope_decode(&envelope).unwrap();
        let vk = crate::keys::public_from_bytes(&pk).unwrap();
        crate::keys::verify_signature(&vk, payload_json.as_bytes(), &Signature::from_bytes(sig.as_slice().try_into().unwrap()))
            .unwrap();
    }

    #[test]
    fn issue_rejects_key_id_mismatch() {
        let ks = KeyStore::generate(1_700_000_000).unwrap();
        let err = issue_license(&ks, &payload(1_700_000_000, 30, "VLA-deadbeefdeadbeef")).unwrap_err();
        assert_eq!(err.code(), "E_INVALID_FIELD");
    }
}
