use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::LicenseError;
use crate::hwid::machine_hwid;

type HmacSha256 = Hmac<Sha256>;

/// Locally cached activation state with an HMAC integrity seal.
///
/// This is *tamper-evident* storage: editing the envelope or the cached
/// metadata invalidates the seal and forces re-verification from the raw
/// license. It is intentionally NOT obfuscation-as-security (see SECURITY.md);
/// the cryptographic verification remains the single source of truth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivatedLicense {
    pub envelope: String,
    pub activated_at: i64,
    pub seal: String,
}

#[derive(Serialize, Deserialize)]
struct CacheDoc {
    license: ActivatedLicense,
}

fn seal(envelope: &str, activated_at: i64) -> String {
    let key = machine_hwid(); // machine-bound sealing key
    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .expect("hmac accepts any key length");
    mac.update(envelope.as_bytes());
    mac.update(&activated_at.to_le_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("VOR_DATA_DIR") {
        return PathBuf::from(dir);
    }
    #[cfg(target_os = "android")]
    let base = "/data/data/ir.vor.secure";
    #[cfg(not(target_os = "android"))]
    let base = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".vor").join("license")
}

const CACHE_FILE: &str = "activated.json";

pub fn save_activation(envelope: &str, now: i64) -> Result<(), LicenseError> {
    let dir = cache_dir();
    fs::create_dir_all(&dir).map_err(|e| LicenseError::Storage(format!("mkdir: {e}")))?;
    let doc = CacheDoc {
        license: ActivatedLicense {
            envelope: envelope.into(),
            activated_at: now,
            seal: seal(envelope, now),
        },
    };
    let path = dir.join(CACHE_FILE);
    let tmp_path = dir.join(".activated.json.tmp");
    fs::write(&tmp_path, serde_json::to_vec(&doc).map_err(|e| LicenseError::Storage(e.to_string()))?)
        .map_err(|e| LicenseError::Storage(format!("write tmp: {e}")))?;
    fs::rename(&tmp_path, &path).map_err(|e| LicenseError::Storage(format!("rename: {e}")))?;
    // Best-effort restrictive perms on unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn load_activation() -> Result<Option<String>, LicenseError> {
    let path = cache_dir().join(CACHE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read(&path).map_err(|e| LicenseError::Storage(format!("read cache: {e}")))?;
    let doc: CacheDoc = serde_json::from_slice(&raw).map_err(|_| LicenseError::CacheCorrupted)?;
    let expected = seal(&doc.license.envelope, doc.license.activated_at);
    if !constant_time_eq(expected.as_bytes(), doc.license.seal.as_bytes()) {
        return Err(LicenseError::CacheCorrupted);
    }
    Ok(Some(doc.license.envelope))
}

pub fn clear_activation() -> Result<(), LicenseError> {
    let path = cache_dir().join(CACHE_FILE);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| LicenseError::Storage(format!("clear: {e}")))?;
    }
    Ok(())
}

/// Load the trusted public key bundle embedded/shipped with the client.
pub fn load_trusted_keys(path: &Path) -> Result<crate::keys::TrustedKeys, LicenseError> {
    let raw = fs::read_to_string(path)
        .map_err(|e| LicenseError::Storage(format!("read trusted keys: {e}")))?;
    serde_json::from_str(&raw).map_err(|e| LicenseError::Malformed(format!("trusted keys: {e}")))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip_and_tamper_detection() {
        let dir = std::env::temp_dir().join(format!("vor-cache-{}", std::process::id()));
        std::env::set_var("VOR_DATA_DIR", &dir);
        let _ = fs::remove_dir_all(&dir);

        assert!(load_activation().unwrap().is_none());
        save_activation("VORLIC1.aaa.bbb.ccc", 1_700_000_000).unwrap();
        let loaded = load_activation().unwrap().unwrap();
        assert_eq!(loaded, "VORLIC1.aaa.bbb.ccc");

        // Tamper with the envelope → seal must break.
        let path = cache_dir().join(CACHE_FILE);
        let mut raw = fs::read_to_string(&path).unwrap().replace("aaa", "XXa");
        raw.truncate(raw.len()); // no-op to satisfy lints
        fs::write(&path, raw).unwrap();
        match load_activation() {
            Err(LicenseError::CacheCorrupted) => {}
            other => panic!("expected CacheCorrupted, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
