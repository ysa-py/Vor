//! Integration tests — the full license matrix from the VOR master spec §40.
//!
//! Every case is covered against the REAL cryptographic implementation
//! (no mocks, no fake success states).

#[allow(unused_imports)]
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use vor_license::{
    envelope_decode, issue_license, machine_hwid, normalize_hwid, verify_license,
    verify_to_report, AuditLog, DevicePolicy, Entitlement, KeyStore, LicenseError,
    LicensePayload, LicenseTier, TrustedKeys, VerifyOptions, FORMAT_VERSION, PRODUCT_ID,
};

const T0: i64 = 1_700_000_000;

struct Fixture {
    keystore: KeyStore,
    trusted: TrustedKeys,
    tmp: PathBuf,
}

fn fixture() -> Fixture {
    let keystore = KeyStore::generate(T0).expect("keystore");
    let trusted = TrustedKeys::from_keystore(&keystore);
    let tmp = std::env::temp_dir().join(format!("vor-it-{}", std::process::id()));
    let _ = fs::create_dir_all(&tmp);
    Fixture { keystore, trusted, tmp }
}

fn payload(fx: &Fixture, mutate: impl FnOnce(&mut LicensePayload)) -> LicensePayload {
    let mut p = LicensePayload {
        license_version: FORMAT_VERSION,
        license_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".into(),
        product: PRODUCT_ID.into(),
        key_id: fx.keystore.active_key_id().unwrap(),
        issued_at: T0,
        not_before: T0,
        expires_at: T0 + 365 * 86_400,
        license_tier: LicenseTier::Enterprise,
        entitlements: vec![Entitlement::CoreTunnel, Entitlement::StealthEngine],
        device_policy: DevicePolicy::default(),
        metadata: None,
    };
    mutate(&mut p);
    p
}

fn opts(now: i64) -> VerifyOptions {
    VerifyOptions::new(now).with_hwid(Some(machine_hwid()))
}

#[test]
fn t01_valid_license_accepted() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    let p = verify_license(&env, &fx.trusted, &opts(T0 + 60)).unwrap();
    assert_eq!(p.license_tier, LicenseTier::Enterprise);
    assert_eq!(p.entitlements.len(), 2);
}

#[test]
fn t02_invalid_signature_rejected() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    let parts: Vec<String> = env.split('.').map(String::from).collect();
    let mut sig = parts[2].clone();
    sig.replace_range(0..1, if sig.starts_with('A') { "B" } else { "A" });
    let env2 = format!("{}.{}.{}.{}", parts[0], parts[1], sig, parts[3]);
    assert_eq!(
        verify_license(&env2, &fx.trusted, &opts(T0 + 60)).unwrap_err().code(),
        "E_SIGNATURE"
    );
}

#[test]
fn t03_modified_payload_rejected() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    let (pj, sig, pk) = envelope_decode(&env).unwrap();
    let mut v: serde_json::Value = serde_json::from_str(&pj).unwrap();
    v["expires_at"] = serde_json::json!(T0 + 400 * 86_400);
    let modified = vor_license::envelope_encode(
        &vor_license::canonical::canonical_json(&v),
        &sig,
        &pk,
    );
    let err = verify_license(&modified, &fx.trusted, &opts(T0 + 60)).unwrap_err();
    assert!(err.code() == "E_SIGNATURE" || err.code() == "E_MALFORMED");
}

#[test]
fn t04_wrong_public_key_rejected() {
    let fx = fixture();
    let other = KeyStore::generate(T0).unwrap();
    // License SIGNED by a foreign (untrusted) key but structurally consistent:
    let mut p = payload(&fx, |_| {});
    p.key_id = other.active_key_id().unwrap();
    let (env, _) = issue_license(&other, &p).unwrap();
    assert_eq!(
        verify_license(&env, &fx.trusted, &opts(T0 + 60)).unwrap_err().code(),
        "E_UNTRUSTED_KEY"
    );
}

#[test]
fn t05_wrong_product_fails_closed() {
    let fx = fixture();
    let p = payload(&fx, |p| p.product = "OTHER".into());
    match issue_license(&fx.keystore, &p) {
        Err(LicenseError::WrongProduct { .. }) => {}
        Ok((env, _)) => {
            let err = verify_license(&env, &fx.trusted, &opts(T0 + 60)).unwrap_err();
            assert_eq!(err.code(), "E_PRODUCT");
        }
        Err(other) => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn t06_expired_license_rejected() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |p| p.expires_at = T0 + 86_400)).unwrap();
    assert_eq!(
        verify_license(&env, &fx.trusted, &opts(T0 + 10 * 86_400)).unwrap_err().code(),
        "E_EXPIRED"
    );
    // Accepted inside its window (just before expiry).
    assert!(verify_license(&env, &fx.trusted, &opts(T0 + 86_400 - 200)).is_ok());
}

#[test]
fn t07_future_license_rejected_before_not_before() {
    let fx = fixture();
    let (env, _) = issue_license(
        &fx.keystore,
        &payload(&fx, |p| {
            p.not_before = T0 + 30 * 86_400;
            p.expires_at = T0 + 395 * 86_400;
        }),
    )
    .unwrap();
    assert_eq!(
        verify_license(&env, &fx.trusted, &opts(T0)).unwrap_err().code(),
        "E_NOT_YET_VALID"
    );
}

#[test]
fn t08_missing_field_rejected() {
    let fx = fixture();
    let mut p = payload(&fx, |_| {});
    p.license_id = "  ".into();
    match issue_license(&fx.keystore, &p) {
        Err(LicenseError::MissingField(f)) => assert_eq!(f, "license_id"),
        other => panic!("expected MissingField, got {other:?}"),
    }
}

#[test]
fn t09_malformed_serialization_rejected() {
    let fx = fixture();
    for bad in ["", "VORLIC1", "garbage", "VORLIC1.a", "VORLIC1.@@@.bbb.ccc"] {
        let err = verify_license(bad, &fx.trusted, &opts(T0)).unwrap_err();
        assert_eq!(err.code(), "E_MALFORMED", "input: {bad}");
    }
}

#[test]
fn t10_unsupported_schema_rejected() {
    let fx = fixture();
    let p = payload(&fx, |p| p.license_version = 99);
    match issue_license(&fx.keystore, &p) {
        Err(LicenseError::UnsupportedSchema(99)) => {}
        other => panic!("expected UnsupportedSchema, got {other:?}"),
    }
}

#[test]
fn t11_invalid_entitlement_rejected() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    let (pj, _sig, _pk) = envelope_decode(&env).unwrap();
    let mut v: serde_json::Value = serde_json::from_str(&pj).unwrap();
    v["entitlements"] = serde_json::json!(["core_tunnel", "makes_coffee"]);
    assert!(
        serde_json::from_value::<LicensePayload>(v).is_err(),
        "serde must reject unknown entitlement variant"
    );
}

#[test]
fn t12_key_rotation_old_and_new() {
    let fx = fixture();
    let kid1 = fx.keystore.active_key_id().unwrap();
    let (env_old, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();

    let mut ks2 = fx.keystore.clone();
    let kid2 = ks2.rotate(T0 + 86_400, false).unwrap(); // keep old key verifiable
    let trusted2 = TrustedKeys::from_keystore(&ks2);
    let (env_new, _) = issue_license(&ks2, &payload(&fx, |p| p.key_id = kid2.clone())).unwrap();

    assert!(verify_license(&env_old, &trusted2, &opts(T0 + 2 * 86_400)).is_ok());
    assert!(verify_license(&env_new, &trusted2, &opts(T0 + 2 * 86_400)).is_ok());
    assert_ne!(kid1, kid2);

    // Hard-retire ALL old keys → old license now rejected (E_UNTRUSTED_KEY).
    let mut ks3 = ks2.clone();
    ks3.rotate(T0 + 3 * 86_400, true).unwrap();
    let trusted3 = TrustedKeys::from_keystore(&ks3);
    assert_eq!(
        verify_license(&env_old, &trusted3, &opts(T0 + 4 * 86_400)).unwrap_err().code(),
        "E_UNTRUSTED_KEY"
    );
    // New key still verifies after hard rotation.
    let (env_new3, _) = issue_license(&ks3, &payload(&fx, |p| p.key_id = ks3.active_key_id().unwrap())).unwrap();
    assert!(verify_license(&env_new3, &trusted3, &opts(T0 + 4 * 86_400)).is_ok());
}

#[test]
fn t13_corrupted_license_rejected() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    assert!(verify_license(&format!("{env}XX"), &fx.trusted, &opts(T0)).is_err());
    // In-place character corruption (stays valid UTF-8, breaks base64/sig).
    let mut chars: Vec<char> = env.chars().collect();
    let idx = chars.len() / 2;
    chars[idx] = if chars[idx] == 'A' { 'B' } else { 'A' };
    let corrupted: String = chars.into_iter().collect();
    assert!(verify_license(&corrupted, &fx.trusted, &opts(T0)).is_err());
}

#[test]
fn t14_hwid_binding_enforced() {
    let fx = fixture();
    let (env, _) = issue_license(
        &fx.keystore,
        &payload(&fx, |p| {
            p.device_policy = DevicePolicy {
                max_devices: 1,
                bound_hwids: vec![machine_hwid()],
            };
        }),
    )
    .unwrap();
    assert!(verify_license(&env, &fx.trusted, &opts(T0 + 60)).is_ok());

    let stranger = VerifyOptions::new(T0 + 60).with_hwid(Some(normalize_hwid(&format!(
        "HWID-SHA256-{}",
        "ab".repeat(32)
    ))));
    assert_eq!(
        verify_license(&env, &fx.trusted, &stranger).unwrap_err().code(),
        "E_DEVICE"
    );
    // No HWID provided → fail-closed.
    let no_hw = VerifyOptions::new(T0 + 60);
    assert_eq!(
        verify_license(&env, &fx.trusted, &no_hw).unwrap_err().code(),
        "E_DEVICE"
    );
}

#[test]
fn t15_local_revocation_works_offline() {
    let fx = fixture();
    let mut p = payload(&fx, |_| {});
    p.license_id = "cccccccc-dddd-4eee-8fff-000011112222".into();
    let (env, _) = issue_license(&fx.keystore, &p).unwrap();
    let mut o = opts(T0 + 60);
    o.revoked.insert(p.license_id.clone());
    assert_eq!(verify_license(&env, &fx.trusted, &o).unwrap_err().code(), "E_REVOKED");
}

#[test]
fn t16_clock_skew_bounded() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |p| p.expires_at = T0 + 86_400)).unwrap();
    assert!(verify_license(&env, &fx.trusted, &opts(T0 + 86_400 + 240)).is_ok());
    assert_eq!(
        verify_license(&env, &fx.trusted, &opts(T0 + 86_400 + 600)).unwrap_err().code(),
        "E_EXPIRED"
    );
}

#[test]
fn t17_report_never_panics_and_serializes() {
    let fx = fixture();
    let (env, _) = issue_license(&fx.keystore, &payload(&fx, |_| {})).unwrap();
    let ok = verify_to_report(&env, &fx.trusted, &opts(T0 + 60));
    assert!(ok.ok && ok.tier.as_deref() == Some("enterprise"));
    let js = serde_json::to_string(&ok).unwrap();
    assert!(js.contains("days_remaining"));
    let bad = verify_to_report("garbage", &fx.trusted, &opts(T0));
    assert!(!bad.ok && bad.error_code.as_deref() == Some("E_MALFORMED"));
}

#[test]
fn t18_audit_log_detects_tampering() {
    let path = fx_tmp("audit");
    {
        let mut log = AuditLog::open(&path).unwrap();
        log.append(T0, "ISSUE", "lic-1").unwrap();
        log.append(T0 + 1, "VERIFY", "lic-1 OK").unwrap();
    }
    let log = AuditLog::open(&path).unwrap();
    assert!(log.verify_chain().is_ok());
    let raw = fs::read_to_string(&path).unwrap().replace("lic-1 OK", "lic-1 FAKE");
    fs::write(&path, raw).unwrap();
    let log = AuditLog::open(&path).unwrap();
    assert!(log.verify_chain().is_err());
}

#[test]
fn t19_keystore_file_roundtrip() {
    let fx = fixture();
    let path = fx.tmp.join("keystore.json");
    fs::write(&path, serde_json::to_string(&fx.keystore).unwrap()).unwrap();
    let loaded: KeyStore =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let (env, _) = issue_license(&loaded, &payload(&fx, |_| {})).unwrap();
    assert!(verify_license(&env, &fx.trusted, &opts(T0 + 60)).is_ok());
}

#[test]
fn t20_envelope_is_canonical_deterministic() {
    let fx = fixture();
    let p = payload(&fx, |_| {});
    let (env1, _) = issue_license(&fx.keystore, &p.clone()).unwrap();
    let (env2, _) = issue_license(&fx.keystore, &p).unwrap();
    // Same payload → identical canonical payload segment (signature may differ).
    let a = env1.split('.').nth(1).unwrap();
    let b = env2.split('.').nth(1).unwrap();
    assert_eq!(a, b);
}

fn fx_tmp(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("vor-it-{name}-{}", std::process::id()));
    let _ = fs::remove_file(&p);
    p
}
