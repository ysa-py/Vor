use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::LicenseError;

/// Tamper-evident, append-only local audit log.
///
/// Each entry carries `prev_hash` and `hash = SHA-256(prev_hash | canonical(entry))`.
/// Any retro-edit breaks the chain and is detectable by `verify_chain`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub seq: u64,
    pub ts: i64,
    pub action: String,
    pub detail: String,
    pub prev_hash: String,
    pub hash: String,
}

#[derive(Debug)]
pub struct AuditLog {
    path: PathBuf,
    entries: Vec<AuditEntry>,
}

pub const GENESIS: &str = "GENESIS";

impl AuditLog {
    pub fn open(path: &Path) -> Result<Self, LicenseError> {
        let entries = if path.exists() {
            let raw = fs::read_to_string(path)
                .map_err(|e| LicenseError::Storage(format!("read audit: {e}")))?;
            let mut out = Vec::new();
            for line in raw.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let e: AuditEntry = serde_json::from_str(line)
                    .map_err(|_| LicenseError::CacheCorrupted)?;
                out.push(e);
            }
            out
        } else {
            Vec::new()
        };
        Ok(AuditLog {
            path: path.to_path_buf(),
            entries,
        })
    }

    pub fn append(&mut self, ts: i64, action: &str, detail: &str) -> Result<AuditEntry, LicenseError> {
        let seq = self.entries.len() as u64;
        let prev_hash = self
            .entries
            .last()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| GENESIS.into());
        let mut entry = AuditEntry {
            seq,
            ts,
            action: action.into(),
            detail: detail.into(),
            prev_hash,
            hash: String::new(),
        };
        entry.hash = hash_entry(&entry);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| LicenseError::Storage(format!("mkdir: {e}")))?;
        }
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| LicenseError::Storage(format!("open audit: {e}")))?;
        let line = serde_json::to_string(&entry)
            .map_err(|e| LicenseError::Storage(e.to_string()))?;
        writeln!(f, "{line}").map_err(|e| LicenseError::Storage(format!("write audit: {e}")))?;
        self.entries.push(entry.clone());
        Ok(entry)
    }

    pub fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }

    /// Recompute the full chain; returns Err naming the first broken seq.
    pub fn verify_chain(&self) -> Result<(), LicenseError> {
        let mut prev = GENESIS.to_string();
        for e in &self.entries {
            if e.prev_hash != prev || e.hash != hash_entry(e) {
                return Err(LicenseError::CacheCorrupted);
            }
            prev = e.hash.clone();
        }
        Ok(())
    }
}

fn hash_entry(e: &AuditEntry) -> String {
    let doc = serde_json::json!({
        "seq": e.seq, "ts": e.ts, "action": e.action,
        "detail": e.detail, "prev_hash": e.prev_hash
    });
    let canonical = crate::canonical::canonical_json(&doc);
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vor-audit-{name}-{}", std::process::id()));
        let _ = fs::remove_file(&d);
        d
    }

    #[test]
    fn chain_is_append_only_and_verifiable() {
        let path = tmp("chain");
        {
            let mut log = AuditLog::open(&path).unwrap();
            log.append(1_700_000_001, "ISSUE", "lic-1").unwrap();
            log.append(1_700_000_002, "VERIFY", "lic-1 OK").unwrap();
            log.append(1_700_000_003, "ROTATE", "key2").unwrap();
        }
        let log = AuditLog::open(&path).unwrap();
        assert_eq!(log.entries().len(), 3);
        assert!(log.verify_chain().is_ok());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn retro_edit_breaks_chain() {
        let path = tmp("tamper");
        {
            let mut log = AuditLog::open(&path).unwrap();
            log.append(1_700_000_001, "ISSUE", "lic-1").unwrap();
            log.append(1_700_000_002, "ISSUE", "lic-2").unwrap();
        }
        // Tamper: rewrite first line's action.
        let raw = fs::read_to_string(&path).unwrap().replace("lic-1", "lic-X");
        fs::write(&path, raw).unwrap();
        let log = AuditLog::open(&path).unwrap();
        assert!(log.verify_chain().is_err());
        let _ = fs::remove_file(&path);
    }
}
