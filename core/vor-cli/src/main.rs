//! `vor-lictool` — administrative CLI for the VOR licensing system.
//!
//! This is the engine behind the *Vor License Manager* application. It runs
//! 100% offline on the air-gapped administrative machine:
//!
//! ```text
//! vor-lictool init-keystore ./vault
//! vor-lictool issue ./vault --tier enterprise --days 365 --hwid HWID-SHA256-... --out lic.vorlic
//! vor-lictool verify ./trusted.json --license lic.vorlic --hwid HWID-SHA256-...
//! vor-lictool rotate ./vault
//! vor-lictool export-public ./vault ./trusted.json
//! vor-lictool audit ./vault/audit.jsonl
//! ```

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::exit;

use vor_license::{
    issue_license, machine_hwid, new_license_id, verify_to_report, AuditLog, DevicePolicy,
    Entitlement, KeyStore, LicensePayload, LicenseTier, TrustedKeys, VerifyOptions,
};

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    exit(2);
}

fn usage() -> ! {
    println!(
        "vor-lictool — VOR offline licensing administration

USAGE:
  vor-lictool init-keystore <dir>              generate a fresh master signing key vault
  vor-lictool export-public  <dir> <out.json>  client trusted-keys bundle (ships in VOR)
  vor-lictool issue <dir> [--tier standard|pro|enterprise] [--days N]
                     [--hwid HWID-SHA256-..]... [--ent entitlement,...]
                     [--id UUID] [--note TEXT] [--out FILE.vorlic]
  vor-lictool verify <trusted.json> --license <file.vorlic> [--hwid HWID] [--at TS]
  vor-lictool revoke <dir> <license-id>
  vor-lictool rotate <dir> [--retire-old]
  vor-lictool audit <dir/audit.jsonl>
  vor-lictool hwid                             print this machine's HWID"
    );
    exit(0);
}

fn load_keystore(dir: &Path) -> KeyStore {
    let path = dir.join("keystore.json");
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| die(&format!("read {}: {e}", path.display())));
    serde_json::from_str(&raw).unwrap_or_else(|e| die(&format!("parse keystore: {e}")))
}

fn save_keystore(dir: &Path, ks: &KeyStore) {
    fs::create_dir_all(dir).unwrap_or_else(|e| die(&format!("mkdir: {e}")));
    let path = dir.join("keystore.json");
    fs::write(&path, serde_json::to_vec_pretty(ks).unwrap())
        .unwrap_or_else(|e| die(&format!("write keystore: {e}")));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
}

fn audit(dir: &Path) -> AuditLog {
    AuditLog::open(&dir.join("audit.jsonl")).unwrap_or_else(|e| die(&format!("audit: {e}")))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        usage();
    }

    match args[0].as_str() {
        "init-keystore" => {
            let dir = PathBuf::from(args.get(1).unwrap_or_else(|| die("missing <dir>")));
            if dir.join("keystore.json").exists() {
                die("keystore already exists — refusing to overwrite (rotate instead)");
            }
            let ks = KeyStore::generate(now()).unwrap_or_else(|e| die(&format!("{e}")));
            let key_id = ks.active_key_id().unwrap_or_default();
            save_keystore(&dir, &ks);
            let mut log = audit(&dir);
            log.append(now(), "INIT_KEYSTORE", &key_id).unwrap();
            println!("✔ keystore created: {}", dir.join("keystore.json").display());
            println!("  active key_id: {key_id}");
            println!("  KEEP THIS DIRECTORY AIR-GAPPED. It contains the private signing key.");
        }

        "export-public" => {
            let dir = PathBuf::from(args.get(1).unwrap_or_else(|| die("missing <dir>")));
            let out = PathBuf::from(args.get(2).unwrap_or_else(|| die("missing <out.json>")));
            let ks = load_keystore(&dir);
            let trusted = TrustedKeys::from_keystore(&ks);
            fs::write(&out, serde_json::to_vec_pretty(&trusted).unwrap())
                .unwrap_or_else(|e| die(&format!("write: {e}")));
            println!("✔ trusted public-key bundle written: {} (embed in VOR client)", out.display());
        }

        "issue" => {
            let dir = PathBuf::from(&args[1]);
            let mut tier = LicenseTier::Pro;
            let mut days: i64 = 365;
            let mut hwids: Vec<String> = Vec::new();
            let mut ents: Vec<Entitlement> = vec![Entitlement::CoreTunnel];
            let mut id: Option<String> = None;
            let mut note: Option<String> = None;
            let mut out: Option<PathBuf> = None;

            let mut i = 2;
            while i < args.len() {
                match args[i].as_str() {
                    "--tier" => {
                        i += 1;
                        tier = LicenseTier::parse(&args[i]).unwrap_or_else(|| die("bad tier"));
                    }
                    "--days" => {
                        i += 1;
                        days = args[i].parse().unwrap_or_else(|_| die("bad --days"));
                    }
                    "--hwid" => {
                        i += 1;
                        hwids.push(vor_license::hwid::normalize_hwid(&args[i]));
                    }
                    "--ent" => {
                        i += 1;
                        ents = args[i]
                            .split(',')
                            .filter_map(Entitlement::parse)
                            .collect::<Vec<_>>();
                        if ents.is_empty() {
                            die("no valid entitlements");
                        }
                    }
                    "--id" => {
                        i += 1;
                        id = Some(args[i].clone());
                    }
                    "--note" => {
                        i += 1;
                        note = Some(args[i].clone());
                    }
                    "--out" => {
                        i += 1;
                        out = Some(PathBuf::from(&args[i]));
                    }
                    other => die(&format!("unknown flag {other}")),
                }
                i += 1;
            }

            let ks = load_keystore(&dir);
            let key_id = ks.active_key_id().unwrap_or_default();
            let t = now();
            let payload = LicensePayload {
                license_version: vor_license::FORMAT_VERSION,
                license_id: id.unwrap_or_else(new_license_id),
                product: vor_license::PRODUCT_ID.into(),
                key_id,
                issued_at: t,
                not_before: t,
                expires_at: t + days * 86_400,
                license_tier: tier,
                entitlements: ents,
                device_policy: DevicePolicy {
                    max_devices: hwids.len().max(1) as u32,
                    bound_hwids: hwids,
                },
                metadata: note,
            };
            let (envelope, _file) = issue_license(&ks, &payload).unwrap_or_else(|e| die(&format!("{e}")));
            let dest = out.unwrap_or_else(|| PathBuf::from(format!("VOR-{}.vorlic", &payload.license_id[..8])));
            fs::write(&dest, serde_json::to_vec_pretty(&serde_json::json!({
                "format": "VORLIC", "version": 2, "envelope": envelope
            })).unwrap()).unwrap_or_else(|e| die(&format!("write license: {e}")));

            let mut log = audit(&dir);
            log.append(now(), "ISSUE", &format!("{} tier={} expires={}", payload.license_id, payload.license_tier.as_str(), payload.expires_at)).unwrap();
            println!("✔ license issued: {}", dest.display());
            println!("  id: {}", payload.license_id);
            println!("  expires_at: {} ({} days)", payload.expires_at, days);
        }

        "verify" => {
            let trusted_path = PathBuf::from(&args[1]);
            let mut lic_path = None;
            let mut hwid = None;
            let mut at = now();
            let mut i = 2;
            while i < args.len() {
                match args[i].as_str() {
                    "--license" => {
                        i += 1;
                        lic_path = Some(PathBuf::from(&args[i]));
                    }
                    "--hwid" => {
                        i += 1;
                        hwid = Some(args[i].clone());
                    }
                    "--at" => {
                        i += 1;
                        at = args[i].parse().unwrap_or_else(|_| die("bad --at"));
                    }
                    other => die(&format!("unknown flag {other}")),
                }
                i += 1;
            }
            let lic_path = lic_path.unwrap_or_else(|| die("missing --license"));
            let raw = fs::read_to_string(&lic_path).unwrap_or_else(|e| die(&format!("read: {e}")));
            let doc: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|e| die(&format!("parse: {e}")));
            let envelope = doc
                .get("envelope")
                .and_then(|e| e.as_str())
                .unwrap_or_else(|| die("missing envelope field"));
            let trusted: TrustedKeys = serde_json::from_str(
                &fs::read_to_string(&trusted_path).unwrap_or_else(|e| die(&format!("read trusted: {e}"))),
            )
            .unwrap_or_else(|e| die(&format!("parse trusted: {e}")));
            let opts = VerifyOptions::new(at).with_hwid(hwid);
            let report = verify_to_report(envelope, &trusted, &opts);
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
            exit(if report.ok { 0 } else { 1 });
        }

        "revoke" => {
            let dir = PathBuf::from(&args[1]);
            let lic_id = args.get(2).unwrap_or_else(|| die("missing <license-id>"));
            let path = dir.join("revoked.json");
            let mut list: HashSet<String> = fs::read_to_string(&path)
                .ok()
                .and_then(|r| serde_json::from_str(&r).ok())
                .unwrap_or_default();
            list.insert(lic_id.clone());
            fs::write(&path, serde_json::to_vec_pretty(&list).unwrap()).unwrap();
            let mut log = audit(&dir);
            log.append(now(), "REVOKE", lic_id).unwrap();
            println!("✔ revoked locally: {lic_id} (re-embed revoked.json in clients on next release)");
        }

        "rotate" => {
            let dir = PathBuf::from(&args[1]);
            let retire = args.iter().any(|a| a == "--retire-old");
            let mut ks = load_keystore(&dir);
            let new_id = ks.rotate(now(), retire).unwrap_or_else(|e| die(&format!("{e}")));
            save_keystore(&dir, &ks);
            let mut log = audit(&dir);
            log.append(now(), "ROTATE", &format!("{new_id} retire_old={retire}")).unwrap();
            println!("✔ rotated. new active key: {new_id}");
            println!("  re-run export-public and ship the updated trusted bundle with the next client release.");
        }

        "audit" => {
            let path = PathBuf::from(&args[1]);
            let log = AuditLog::open(&path).unwrap_or_else(|e| die(&format!("{e}")));
            match log.verify_chain() {
                Ok(()) => println!("✔ audit chain intact ({} entries)", log.entries().len()),
                Err(e) => die(&format!("AUDIT CHAIN BROKEN: {e}")),
            }
            for e in log.entries() {
                println!("  {:>4} {} {:<14} {}", e.seq, e.ts, e.action, e.detail);
            }
        }

        "hwid" => println!("{}", machine_hwid()),

        _ => usage(),
    }
}
