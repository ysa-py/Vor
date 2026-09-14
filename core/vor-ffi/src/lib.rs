//! Stable C ABI for the Flutter clients (dart:ffi).
//!
//! Convention: every function takes a UTF-8 JSON string argument and returns
//! an owned UTF-8 JSON string (or `null` on panic-guarded failure). Callers
//! MUST release results with `vor_string_free`.
//!
//! All results are serialized with the SAME documented structure as the web
//! preview, keeping behavior identical across platforms.

use std::ffi::{c_char, CStr, CString};
use std::ptr;

use vor_engine::controller::{connect, ConnectRequest};
use vor_engine::dpi::features::DpiFeatures;
use vor_engine::subscription;
use vor_engine::xray::{self, HardeningOptions, ProfileEndpoint};
use vor_license::{machine_hwid, verify_to_report, TrustedKeys, VerifyOptions};

fn in_json(ptr: *const c_char) -> Option<serde_json::Value> {
    if ptr.is_null() {
        return None;
    }
    let s = unsafe { CStr::from_ptr(ptr) }.to_str().ok()?;
    serde_json::from_str(s).ok()
}

fn out_json(v: serde_json::Value) -> *mut c_char {
    match CString::new(v.to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

fn err_json(code: &str, msg: &str) -> *mut c_char {
    out_json(serde_json::json!({ "ok": false, "code": code, "message": msg }))
}

/// Free a string returned by this library.
///
/// # Safety
/// `s` must be a pointer returned by one of the `vor_*` functions in this
/// library and must not be freed more than once.
#[no_mangle]
pub unsafe extern "C" fn vor_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Machine fingerprint: `{ "hwid": "HWID-SHA256-..." }`
#[no_mangle]
pub extern "C" fn vor_hwid_get() -> *mut c_char {
    out_json(serde_json::json!({ "hwid": machine_hwid() }))
}

/// Verify a license offline.
/// In: `{ "envelope": "...", "trusted_keys": {...}, "now": 1700000000, "hwid": "..." }`
/// Out: `VerificationReport` JSON.
#[no_mangle]
pub extern "C" fn vor_license_verify(arg: *const c_char) -> *mut c_char {
    let Some(v) = in_json(arg) else {
        return err_json("E_MALFORMED", "argument is not valid JSON");
    };
    let Some(envelope) = v.get("envelope").and_then(|x| x.as_str()).map(String::from) else {
        return err_json("E_MALFORMED", "missing envelope");
    };
    let trusted: TrustedKeys = match v.get("trusted_keys") {
        Some(t) => match serde_json::from_value(t.clone()) {
            Ok(t) => t,
            Err(e) => return err_json("E_MALFORMED", &format!("trusted_keys: {e}")),
        },
        None => return err_json("E_MALFORMED", "missing trusted_keys"),
    };
    let now = v.get("now").and_then(|x| x.as_i64()).unwrap_or_else(vor_engine::controller::now);
    let hwid = v.get("hwid").and_then(|x| x.as_str()).map(String::from);
    let report = verify_to_report(&envelope, &trusted, &VerifyOptions::new(now).with_hwid(hwid));
    out_json(serde_json::to_value(report).unwrap_or_else(|_| serde_json::json!({"ok": false})))
}

/// Smart-engine connection decision.
/// In: a `ConnectRequest` JSON. Out: a `ConnectResult` JSON.
#[no_mangle]
pub extern "C" fn vor_engine_decide(arg: *const c_char) -> *mut c_char {
    let Some(v) = in_json(arg) else {
        return err_json("E_MALFORMED", "argument is not valid JSON");
    };
    let req: ConnectRequest = match serde_json::from_value(v) {
        Ok(r) => r,
        Err(e) => return err_json("E_MALFORMED", &format!("connect request: {e}")),
    };
    let result = connect(&req);
    out_json(serde_json::to_value(&result).unwrap_or_else(|_| serde_json::json!({"ok": false})))
}

/// DPI classification.
/// In: `{ "features": DpiFeatures }`. Out: `DpiVerdict`.
#[no_mangle]
pub extern "C" fn vor_dpi_classify(arg: *const c_char) -> *mut c_char {
    let Some(v) = in_json(arg) else {
        return err_json("E_MALFORMED", "argument is not valid JSON");
    };
    let feats: DpiFeatures = match v.get("features") {
        Some(f) => match serde_json::from_value(f.clone()) {
            Ok(f) => f,
            Err(e) => return err_json("E_MALFORMED", &format!("features: {e}")),
        },
        None => return err_json("E_MALFORMED", "missing features"),
    };
    let verdict = vor_engine::dpi::model::classify(&feats);
    out_json(serde_json::to_value(&verdict).unwrap_or_else(|_| serde_json::json!({"ok": false})))
}

/// Build an Xray config.
/// In: `{ "profile": ProfileEndpoint, "protocol": "vless|vmess|trojan|shadowsocks", "hardening": HardeningOptions }`
/// Out: `{ "config": <xray json> }`
#[no_mangle]
pub extern "C" fn vor_xray_build(arg: *const c_char) -> *mut c_char {
    let Some(v) = in_json(arg) else {
        return err_json("E_MALFORMED", "argument is not valid JSON");
    };
    let profile: ProfileEndpoint = match v.get("profile") {
        Some(p) => match serde_json::from_value(p.clone()) {
            Ok(p) => p,
            Err(e) => return err_json("E_MALFORMED", &format!("profile: {e}")),
        },
        None => return err_json("E_MALFORMED", "missing profile"),
    };
    let hard: HardeningOptions = v
        .get("hardening")
        .and_then(|h| serde_json::from_value(h.clone()).ok())
        .unwrap_or_default();
    let protocol = v.get("protocol").and_then(|p| p.as_str()).unwrap_or("vless");
    let config = if protocol == "vless" {
        xray::build_vless_config(&profile, &hard)
    } else {
        xray::build_generic_config(protocol, &profile, &hard)
    };
    out_json(serde_json::json!({ "config": config }))
}

/// Parse a share link or subscription payload.
/// In: `{ "payload": "..." }`. Out: `{ "profiles": [ParsedProfile...], "errors": [...] }`
#[no_mangle]
pub extern "C" fn vor_subscription_parse(arg: *const c_char) -> *mut c_char {
    let Some(v) = in_json(arg) else {
        return err_json("E_MALFORMED", "argument is not valid JSON");
    };
    let Some(payload) = v.get("payload").and_then(|p| p.as_str()) else {
        return err_json("E_MALFORMED", "missing payload");
    };
    let mut profiles = Vec::new();
    let mut errors = Vec::new();
    for r in subscription::parse_subscription(payload) {
        match r {
            Ok(p) => profiles.push(p),
            Err(e) => errors.push(serde_json::json!({
                "error": format!("{e:?}"),
                "input": "<redacted>"
            })),
        }
    }
    out_json(serde_json::json!({ "profiles": profiles, "errors": errors }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn hwid_roundtrip_through_abi() {
        let raw = vor_hwid_get();
        assert!(!raw.is_null());
        let s = unsafe { CStr::from_ptr(raw) }.to_str().unwrap();
        assert!(s.contains("HWID-SHA256-"));
        unsafe { vor_string_free(raw) };
    }

    #[test]
    fn license_verify_abi_rejects_garbage() {
        let arg = CString::new("{\"envelope\":\"garbage\",\"trusted_keys\":{\"trusted_version\":1,\"keys\":{}},\"now\":1700000000}").unwrap();
        let raw = vor_license_verify(arg.as_ptr());
        let s = unsafe { CStr::from_ptr(raw) }.to_str().unwrap();
        let v: serde_json::Value = serde_json::from_str(s).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["error_code"], "E_MALFORMED");
        unsafe { vor_string_free(raw) };
    }

    #[test]
    fn subscription_parse_abi() {
        let arg = CString::new("{\"payload\":\"\"}").unwrap();
        let raw = vor_subscription_parse(arg.as_ptr());
        let s = unsafe { CStr::from_ptr(raw) }.to_str().unwrap();
        assert!(s.contains("\"profiles\""));
        unsafe { vor_string_free(raw) };
    }
}
