use sha2::{Digest, Sha256};

/// `HWID-SHA256-<64 hex>` — a deterministic machine fingerprint.
///
/// The fingerprint mixes platform attributes that are stable on real devices
/// but meaningless across machines. It is a *binding* mechanism, not a secret:
/// the raw attributes are never transmitted anywhere (offline verification).
pub fn machine_hwid() -> String {
    let mut h = Sha256::new();
    feed(&mut h, "vor.hwid.v2");
    feed(&mut h, &std::env::var("VOR_HWID_SALT").unwrap_or_default());
    feed(&mut h, &hostname());
    feed(&mut h, &username());
    feed(&mut h, &os_info());
    feed(&mut h, &cpu_info());
    let digest = h.finalize();
    format!("HWID-SHA256-{}", hex::encode(digest))
}

/// Normalize any HWID input to canonical lowercase `hwid-sha256-<hex>` form.
pub fn normalize_hwid(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    if lower.starts_with("hwid-sha256-") {
        lower
    } else {
        format!("hwid-sha256-{}", lower.trim_start_matches("0x"))
    }
}

fn feed(h: &mut Sha256, s: &str) {
    h.update(s.as_bytes());
    h.update([0x1f]); // unit separator avoids attribute-boundary ambiguity
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".into())
}

fn username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown-user".into())
}

fn os_info() -> String {
    format!("{}|{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn cpu_info() -> String {
    // Stable-enough core count; avoids unsafe CPUID or privileged reads.
    std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "na".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hwid_is_deterministic_within_process() {
        assert_eq!(machine_hwid(), machine_hwid());
        assert!(machine_hwid().starts_with("HWID-SHA256-"));
        assert_eq!(machine_hwid().len(), "HWID-SHA256-".len() + 64);
    }

    #[test]
    fn normalize_handles_variants() {
        let raw = machine_hwid();
        assert_eq!(normalize_hwid(&raw), raw.to_lowercase());
        assert_eq!(
            normalize_hwid("0xDEADBEEF"),
            "hwid-sha256-deadbeef"
        );
    }
}
