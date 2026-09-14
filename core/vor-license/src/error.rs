use thiserror::Error;

/// Typed license errors. Every failure path is explicit — the gate fails closed.
#[derive(Debug, Error, PartialEq, Clone)]
pub enum LicenseError {
    #[error("malformed license input: {0}")]
    Malformed(String),

    #[error("unsupported license schema version: {0}")]
    UnsupportedSchema(i64),

    #[error("missing required field: {0}")]
    MissingField(String),

    #[error("invalid field value: {field}: {reason}")]
    InvalidField { field: String, reason: String },

    #[error("signature verification failed")]
    BadSignature,

    #[error("signing key is not trusted (key_id={0})")]
    UntrustedKey(String),

    #[error("license is bound to product '{expected}' but found '{found}'")]
    WrongProduct { expected: String, found: String },

    #[error("license expired at {0}")]
    Expired(i64),

    #[error("license is not valid before {0}")]
    NotYetValid(i64),

    #[error("unknown entitlement: {0}")]
    UnknownEntitlement(String),

    #[error("device not licensed (HWID mismatch)")]
    DeviceMismatch,

    #[error("license has been locally revoked")]
    Revoked,

    #[error("license integrity cache corrupted")]
    CacheCorrupted,

    #[error("io/storage failure: {0}")]
    Storage(String),
}

impl LicenseError {
    /// Stable machine-readable code used by the UI gate and diagnostics.
    pub fn code(&self) -> &'static str {
        match self {
            LicenseError::Malformed(_) => "E_MALFORMED",
            LicenseError::UnsupportedSchema(_) => "E_SCHEMA",
            LicenseError::MissingField(_) => "E_MISSING_FIELD",
            LicenseError::InvalidField { .. } => "E_INVALID_FIELD",
            LicenseError::BadSignature => "E_SIGNATURE",
            LicenseError::UntrustedKey(_) => "E_UNTRUSTED_KEY",
            LicenseError::WrongProduct { .. } => "E_PRODUCT",
            LicenseError::Expired(_) => "E_EXPIRED",
            LicenseError::NotYetValid(_) => "E_NOT_YET_VALID",
            LicenseError::UnknownEntitlement(_) => "E_ENTITLEMENT",
            LicenseError::DeviceMismatch => "E_DEVICE",
            LicenseError::Revoked => "E_REVOKED",
            LicenseError::CacheCorrupted => "E_CACHE",
            LicenseError::Storage(_) => "E_STORAGE",
        }
    }
}
