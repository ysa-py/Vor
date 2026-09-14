use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::error::LicenseError;

/// Deterministic key id derived from the public key:
/// `VLA-<first 16 hex chars of SHA-256(pubkey)>`
pub fn derive_key_id(public: &VerifyingKey) -> String {
    let digest = Sha256::digest(public.as_bytes());
    format!("VLA-{}", hex::encode(&digest[..8]))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyStatus {
    Active,
    Retired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRecord {
    pub key_id: String,
    #[serde(with = "pk_bytes")]
    pub public: VerifyingKey,
    pub status: KeyStatus,
    pub created_at: i64,
    /// Operator note (e.g. "master key", "compromised — retired 2027-01").
    #[serde(default)]
    pub note: String,
}

/// The operator-side signing keystore (License Manager only).
/// **The private key in this file must never leave the administrative host.**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyStore {
    pub keystore_version: i64,
    #[serde(with = "sk_bytes")]
    pub signing_key: SigningKey,
    /// Explicit pointer to the ACTIVE signing key (avoids ambiguity when an
    /// old key remains verifiable after a soft rotation).
    pub active_key_id: String,
    pub keys: BTreeMap<String, KeyRecord>,
}

/// The client-side trusted public-key set. Ships inside VOR builds.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrustedKeys {
    pub trusted_version: i64,
    pub keys: BTreeMap<String, KeyRecord>,
}

impl TrustedKeys {
    pub fn from_keystore(store: &KeyStore) -> Self {
        TrustedKeys {
            trusted_version: 1,
            keys: store.keys.clone(),
        }
    }
    pub fn is_trusted(&self, key_id: &str) -> bool {
        self.keys
            .get(key_id)
            .map(|k| k.status == KeyStatus::Active)
            .unwrap_or(false)
    }
}

impl KeyStore {
    /// Generate a fresh master signing key (air-gapped operation).
    pub fn generate(now: i64) -> Result<Self, LicenseError> {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let key_id = derive_key_id(&signing_key.verifying_key());
        let record = KeyRecord {
            key_id: key_id.clone(),
            public: signing_key.verifying_key(),
            status: KeyStatus::Active,
            created_at: now,
            note: "master key".into(),
        };
        let mut keys = BTreeMap::new();
        keys.insert(key_id.clone(), record);
        Ok(KeyStore {
            keystore_version: 1,
            signing_key,
            active_key_id: key_id,
            keys,
        })
    }

    /// Rotate: generate a NEW signing key.
    ///
    /// * `retire_old == false` (soft): previous public keys stay verifiable —
    ///   old licenses keep working; new licenses use the new key.
    /// * `retire_old == true`  (hard): every other key becomes Retired —
    ///   old licenses fail-closed (emergency compromise response).
    pub fn rotate(&mut self, now: i64, retire_old: bool) -> Result<String, LicenseError> {
        if retire_old {
            for rec in self.keys.values_mut() {
                if rec.status == KeyStatus::Active {
                    rec.status = KeyStatus::Retired;
                    rec.note = format!("{} (retired at rotation {now})", rec.note);
                }
            }
        }
        let mut csprng = OsRng;
        let new_key = SigningKey::generate(&mut csprng);
        let key_id = derive_key_id(&new_key.verifying_key());
        self.keys.insert(
            key_id.clone(),
            KeyRecord {
                key_id: key_id.clone(),
                public: new_key.verifying_key(),
                status: KeyStatus::Active,
                created_at: now,
                note: "rotated master key".into(),
            },
        );
        self.signing_key = new_key;
        self.active_key_id = key_id.clone();
        Ok(key_id)
    }

    pub fn active_key_id(&self) -> Option<String> {
        self.keys.contains_key(&self.active_key_id).then(|| self.active_key_id.clone())
    }

    /// Sign canonical payload bytes. Returns (key_id, signature).
    pub fn sign(&self, canonical_payload: &[u8]) -> Result<(String, ed25519_dalek::Signature), LicenseError> {
        let key_id = self.active_key_id().ok_or_else(|| LicenseError::UntrustedKey("no active signing key".into()))?;
        Ok((key_id, self.signing_key.sign(canonical_payload)))
    }
}

/// Verify a signature against an explicit public key.
pub fn verify_signature(
    public: &VerifyingKey,
    canonical_payload: &[u8],
    signature: &Signature,
) -> Result<(), LicenseError> {
    public
        .verify(canonical_payload, signature)
        .map_err(|_| LicenseError::BadSignature)
}

/// Parse a public key from raw 32-byte ed25519 form.
pub fn public_from_bytes(bytes: &[u8]) -> Result<VerifyingKey, LicenseError> {
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| LicenseError::Malformed("public key must be 32 bytes".into()))?;
    VerifyingKey::from_bytes(&arr).map_err(|_| LicenseError::Malformed("invalid public key".into()))
}

mod pk_bytes {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(k: &VerifyingKey, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(k.as_bytes()))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<VerifyingKey, D::Error> {
        let s = String::deserialize(d)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        public_from_bytes(&bytes).map_err(serde::de::Error::custom)
    }
}

mod sk_bytes {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(k: &SigningKey, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(k.to_bytes()))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<SigningKey, D::Error> {
        let s = String::deserialize(d)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("signing key must be 32 bytes"))?;
        Ok(SigningKey::from_bytes(&arr))
    }
}
