use std::collections::HashSet;

use ed25519_dalek::Signature;

use crate::error::LicenseError;
use crate::format::LicensePayload;
use crate::hwid::normalize_hwid;
use crate::keys::{public_from_bytes, verify_signature, TrustedKeys};

/// Default tolerated clock drift: 5 minutes.
pub const DEFAULT_CLOCK_SKEW_SECS: i64 = 300;

#[derive(Debug, Clone)]
pub struct VerifyOptions {
    /// Evaluation timestamp (unix seconds). Defaults to now.
    pub now: i64,
    /// Tolerated clock drift in seconds.
    pub clock_skew_secs: i64,
    /// This machine's HWID (enforced when the license binds devices).
    pub device_hwid: Option<String>,
    /// Locally revoked license ids (offline revocation list).
    pub revoked: HashSet<String>,
}

impl VerifyOptions {
    pub fn new(now: i64) -> Self {
        VerifyOptions {
            now,
            clock_skew_secs: DEFAULT_CLOCK_SKEW_SECS,
            device_hwid: None,
            revoked: HashSet::new(),
        }
    }
    pub fn with_hwid(mut self, hwid: Option<String>) -> Self {
        self.device_hwid = hwid;
        self
    }
}

/// Full verification result — mirrors the UI gate report.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VerificationReport {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_remaining: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entitlements: Option<Vec<String>>,
}

/// Verify a license envelope against the trusted key set. **Fail-closed.**
///
/// Order (cheap → expensive, cryptographic authority enforced):
/// parse → schema → trusted key → signature → product → time window →
/// entitlements → device policy → local revocation.
pub fn verify_license(
    envelope: &str,
    trusted: &TrustedKeys,
    opts: &VerifyOptions,
) -> Result<LicensePayload, LicenseError> {
    // 1) Parse envelope ------------------------------------------------------
    let (payload_json, sig_bytes, pk_bytes) = crate::envelope_decode(envelope)?;

    // 2) Payload structure + schema ------------------------------------------
    let payload: LicensePayload = serde_json::from_str(&payload_json)
        .map_err(|e| LicenseError::Malformed(format!("payload json: {e}")))?;
    payload.validate_schema()?;

    // 3) Signature byte integrity ---------------------------------------------
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| LicenseError::Malformed("signature must be 64 bytes".into()))?;
    let signature = Signature::from_bytes(&sig_arr);

    // 4) Trust: embedded pubkey must hash to the declared key_id AND be trusted.
    let vk = public_from_bytes(&pk_bytes)?;
    let derived_id = crate::keys::derive_key_id(&vk);
    if derived_id != payload.key_id {
        return Err(LicenseError::Malformed(
            "embedded public key does not match declared key_id".into(),
        ));
    }
    if !trusted.is_trusted(&payload.key_id) {
        return Err(LicenseError::UntrustedKey(payload.key_id));
    }

    // 5) Cryptographic authority ------------------------------------------------
    verify_signature(&vk, payload_json.as_bytes(), &signature)?;

    // 6) Time window (with bounded skew tolerance) ------------------------------
    let skew = opts.clock_skew_secs.max(0);
    if opts.now < payload.not_before.saturating_sub(skew) {
        return Err(LicenseError::NotYetValid(payload.not_before));
    }
    if opts.now > payload.expires_at.saturating_add(skew) {
        return Err(LicenseError::Expired(payload.expires_at));
    }

    // 7) Entitlements are schema-validated by serde; unknown values already fail.
    //    (serde deny-unknown would error at deserialize; we parse to typed enum.)

    // 8) Device policy -----------------------------------------------------------
    if !payload.device_policy.bound_hwids.is_empty() {
        let hw = opts
            .device_hwid
            .as_deref()
            .map(normalize_hwid)
            .ok_or(LicenseError::DeviceMismatch)?;
        let bound: HashSet<String> = payload
            .device_policy
            .bound_hwids
            .iter()
            .map(|h| normalize_hwid(h))
            .collect();
        if !bound.contains(&hw) {
            return Err(LicenseError::DeviceMismatch);
        }
    }

    // 9) Local revocation ---------------------------------------------------------
    if opts.revoked.contains(&payload.license_id) {
        return Err(LicenseError::Revoked);
    }

    Ok(payload)
}

/// Run verification and ALWAYS produce a serializable report (never panics).
pub fn verify_to_report(
    envelope: &str,
    trusted: &TrustedKeys,
    opts: &VerifyOptions,
) -> VerificationReport {
    match verify_license(envelope, trusted, opts) {
        Ok(p) => {
            let days = ((p.expires_at - opts.now).max(0)) / 86_400;
            VerificationReport {
                ok: true,
                error_code: None,
                error: None,
                license_id: Some(p.license_id.clone()),
                tier: Some(p.license_tier.as_str().into()),
                key_id: Some(p.key_id.clone()),
                expires_at: Some(p.expires_at),
                days_remaining: Some(days),
                entitlements: Some(p.entitlements.iter().map(|e| e.as_str().into()).collect()),
            }
        }
        Err(e) => VerificationReport {
            ok: false,
            error_code: Some(e.code().into()),
            error: Some(e.to_string()),
            license_id: None,
            tier: None,
            key_id: None,
            expires_at: None,
            days_remaining: None,
            entitlements: None,
        },
    }
}
