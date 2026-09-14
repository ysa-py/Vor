use serde::{Deserialize, Serialize};

/// Product identifier. VOR licenses are bound to this product only.
pub const PRODUCT_ID: &str = "VOR";

/// Current license schema version. Clients reject unknown versions (fail-closed).
pub const FORMAT_VERSION: i64 = 2;

/// Envelope prefix. `VORLIC1.<payload>.<sig>.<pubkey>`
pub const ENVELOPE_PREFIX: &str = "VORLIC1";

/// License tiers (mirrors the License Manager tier selector).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseTier {
    Standard,
    Pro,
    Enterprise,
}

impl LicenseTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            LicenseTier::Standard => "standard",
            LicenseTier::Pro => "pro",
            LicenseTier::Enterprise => "enterprise",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "standard" => Some(LicenseTier::Standard),
            "pro" => Some(LicenseTier::Pro),
            "enterprise" => Some(LicenseTier::Enterprise),
            _ => None,
        }
    }
}

/// Known entitlements. Unknown entitlements are rejected at verification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Entitlement {
    /// Core tunnel (all base protocols).
    CoreTunnel,
    /// Smart anti-DPI engine (AI evasion layer).
    StealthEngine,
    /// Multi-hop / relay chains for blackout mode.
    RelayChains,
    /// Unlimited devices override (device_policy still applies).
    UnlimitedDevices,
    /// Priority endpoint fleet.
    PriorityFleet,
}

impl Entitlement {
    pub fn as_str(&self) -> &'static str {
        match self {
            Entitlement::CoreTunnel => "core_tunnel",
            Entitlement::StealthEngine => "stealth_engine",
            Entitlement::RelayChains => "relay_chains",
            Entitlement::UnlimitedDevices => "unlimited_devices",
            Entitlement::PriorityFleet => "priority_fleet",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "core_tunnel" => Some(Entitlement::CoreTunnel),
            "stealth_engine" => Some(Entitlement::StealthEngine),
            "relay_chains" => Some(Entitlement::RelayChains),
            "unlimited_devices" => Some(Entitlement::UnlimitedDevices),
            "priority_fleet" => Some(Entitlement::PriorityFleet),
            _ => None,
        }
    }
    pub fn all() -> &'static [Entitlement] {
        &[
            Entitlement::CoreTunnel,
            Entitlement::StealthEngine,
            Entitlement::RelayChains,
            Entitlement::UnlimitedDevices,
            Entitlement::PriorityFleet,
        ]
    }
}

/// Device binding policy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DevicePolicy {
    /// Maximum concurrent device activations. 0 = unlimited.
    #[serde(default)]
    pub max_devices: u32,
    /// Explicit HWID allow-list (SHA-256 machine fingerprints). Empty = not bound.
    #[serde(default)]
    pub bound_hwids: Vec<String>,
}

/// The canonical, signed license payload.
///
/// Serialization is canonical JSON (sorted keys, no whitespace); the signature
/// covers exactly these bytes. Any change to any field breaks the signature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LicensePayload {
    /// License schema version.
    pub license_version: i64,
    /// Globally unique license id (UUIDv4-formatted string).
    pub license_id: String,
    /// Product binding — always "VOR".
    pub product: String,
    /// Identifier of the signing key (`VLA-<hex16>`).
    pub key_id: String,
    /// Unix seconds — issuance moment.
    pub issued_at: i64,
    /// Unix seconds — license must not be accepted before this moment.
    pub not_before: i64,
    /// Unix seconds — hard expiration (enforced locally, offline).
    pub expires_at: i64,
    /// Commercial tier.
    pub license_tier: LicenseTier,
    /// Feature entitlements granted by this license.
    pub entitlements: Vec<Entitlement>,
    /// Device binding policy.
    pub device_policy: DevicePolicy,
    /// Optional free-form operator reference (customer code, order ref...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

impl LicensePayload {
    /// Structural validation independent of cryptography and time.
    pub fn validate_schema(&self) -> Result<(), crate::error::LicenseError> {
        use crate::error::LicenseError as E;
        if self.license_version != FORMAT_VERSION {
            return Err(E::UnsupportedSchema(self.license_version));
        }
        if self.license_id.trim().is_empty() {
            return Err(E::MissingField("license_id".into()));
        }
        if self.key_id.trim().is_empty() {
            return Err(E::MissingField("key_id".into()));
        }
        if self.product != PRODUCT_ID {
            return Err(E::WrongProduct {
                expected: PRODUCT_ID.into(),
                found: self.product.clone(),
            });
        }
        if self.expires_at <= self.not_before {
            return Err(E::InvalidField {
                field: "expires_at".into(),
                reason: "expires_at must be after not_before".into(),
            });
        }
        if self.issued_at > self.expires_at {
            return Err(E::InvalidField {
                field: "issued_at".into(),
                reason: "issued_at cannot be after expiration".into(),
            });
        }
        if self.entitlements.is_empty() {
            return Err(E::MissingField("entitlements".into()));
        }
        for hw in &self.device_policy.bound_hwids {
            let clean = hw.trim().to_lowercase();
            let hexpart = clean.strip_prefix("hwid-sha256-").unwrap_or(&clean);
            if hexpart.len() != 64 || !hexpart.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(E::InvalidField {
                    field: "device_policy.bound_hwids".into(),
                    reason: format!("invalid HWID format: {hw}"),
                });
            }
        }
        Ok(())
    }
}

/// A `.vorlic` file on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseFile {
    pub format: String, // "VORLIC"
    pub version: i64,   // 2
    pub envelope: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_rejects_bad_window() {
        let p = sample(LicenseTier::Pro);
        let mut bad = p.clone();
        bad.expires_at = bad.not_before - 10;
        assert!(bad.validate_schema().is_err());
        assert!(p.validate_schema().is_ok());
    }

    #[test]
    fn schema_rejects_wrong_product() {
        let mut p = sample(LicenseTier::Standard);
        p.product = "SOMETHING".into();
        match p.validate_schema() {
            Err(crate::error::LicenseError::WrongProduct { .. }) => {}
            other => panic!("expected WrongProduct, got {other:?}"),
        }
    }

    fn sample(tier: LicenseTier) -> LicensePayload {
        LicensePayload {
            license_version: FORMAT_VERSION,
            license_id: "0f0e0d0c-1111-4222-8333-444455556666".into(),
            product: PRODUCT_ID.into(),
            key_id: "VLA-0011223344556677".into(),
            issued_at: 1_700_000_000,
            not_before: 1_700_000_000,
            expires_at: 1_730_000_000,
            license_tier: tier,
            entitlements: vec![Entitlement::CoreTunnel],
            device_policy: DevicePolicy::default(),
            metadata: None,
        }
    }
}
