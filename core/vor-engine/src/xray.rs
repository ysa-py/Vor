//! Xray-core configuration generation with anti-DPI hardening applied.
//!
//! Produces complete, valid Xray JSON for the transport classes.
//! Domestic (Iranian) traffic and private ranges stay DIRECT; only foreign
//! traffic enters the tunnel. DNS strategy follows the countermeasure plan.
//!
//! NOTE: raw-socket countermeasures (ClientHello split, MSS clamp, port
//! hopping) are applied by the PLATFORM layer — goodbyeDPI-style driver on
//! Windows, nftables/iptables on OpenWrt, VpnService MTU control on Android —
//! because Xray-core itself does not expose fragmentation knobs.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::dpi::countermeasures::DnsMode;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileEndpoint {
    pub tag: String,
    pub address: String,
    pub port: u16,
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub sni: Option<String>,
    /// Reality server public key (presence selects the Reality transport).
    #[serde(default)]
    pub public_key: Option<String>,
    #[serde(default)]
    pub short_id: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub encryption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HardeningOptions {
    pub clienthello_split_byte: Option<u16>,
    pub mss_clamp: Option<u16>,
    pub utls_profile: String,
    pub padding_bytes: u16,
    pub mux_concurrency: Option<u8>,
    pub port_hop_interval: Option<u16>,
    pub dns_mode: DnsMode,
    pub blackout: bool,
}

impl Default for HardeningOptions {
    fn default() -> Self {
        HardeningOptions {
            clienthello_split_byte: None,
            mss_clamp: None,
            utls_profile: "chrome".into(),
            padding_bytes: 0,
            mux_concurrency: None,
            port_hop_interval: None,
            dns_mode: DnsMode::Doh,
            blackout: false,
        }
    }
}

pub const SOCKS_INBOUND_PORT: u16 = 10808;
pub const HTTP_INBOUND_PORT: u16 = 10809;

/// Build the full Xray-core config for a VLESS endpoint (Reality or WS+TLS+CDN).
pub fn build_vless_config(ep: &ProfileEndpoint, hard: &HardeningOptions) -> Value {
    let (stream, flow) = match ep.public_key.as_deref() {
        Some(pk) => (
            // Reality: TLS impersonation with uTLS fingerprint, no real cert.
            json!({
                "network": "tcp",
                "security": "reality",
                "realitySettings": {
                    "show": false,
                    "serverName": ep.sni.clone().unwrap_or_default(),
                    "fingerprint": hard.utls_profile,
                    "publicKey": pk,
                    "shortId": ep.short_id.clone().unwrap_or_default(),
                    "spiderX": "/"
                }
            }),
            "xtls-rprx-vision",
        ),
        None => (
            // WS+TLS via CDN.
            json!({
                "network": "ws",
                "security": "tls",
                "tlsSettings": {
                    "serverName": ep.sni.clone().unwrap_or_else(|| ep.host.clone().unwrap_or_default()),
                    "fingerprint": hard.utls_profile,
                    "alpn": ["h2", "http/1.1"],
                    "allowInsecure": false
                },
                "wsSettings": {
                    "path": format!("{}{}", ep.path.clone().unwrap_or_default(), padding_query(hard)),
                    "headers": { "Host": ep.host.clone().unwrap_or_default() }
                }
            }),
            "",
        ),
    };

    let proxy = json!({
        "tag": format!("proxy-{}", ep.tag),
        "protocol": "vless",
        "settings": {
            "vnext": [{
                "address": ep.address,
                "port": ep.port,
                "users": [{
                    "id": ep.uuid,
                    "encryption": "none",
                    "level": 0,
                    "flow": flow
                }]
            }]
        },
        "streamSettings": stream,
        "mux": match hard.mux_concurrency {
            Some(c) => json!({ "enabled": true, "concurrency": c as i64, "xudpConcurrency": 16 }),
            None => json!({ "enabled": false })
        }
    });
    full_config(vec![proxy], hard)
}

/// Build the full Xray-core config for VMess+WS / Trojan / Shadowsocks-2022.
pub fn build_generic_config(
    protocol: &str,
    ep: &ProfileEndpoint,
    hard: &HardeningOptions,
) -> Value {
    let settings = match protocol {
        "vmess" => json!({
            "vnext": [{
                "address": ep.address,
                "port": ep.port,
                "users": [{
                    "id": ep.uuid,
                    "security": ep.encryption.clone().unwrap_or_else(|| "auto".into()),
                    "alterId": 0,
                    "level": 0
                }]
            }]
        }),
        "trojan" => json!({
            "servers": [{
                "address": ep.address,
                "port": ep.port,
                "password": ep.password.clone().unwrap_or_default(),
                "level": 0
            }]
        }),
        "shadowsocks" => json!({
            "servers": [{
                "address": ep.address,
                "port": ep.port,
                "method": ep.encryption.clone().unwrap_or_else(|| "2022-blake3-aes-128-gcm".into()),
                "password": ep.password.clone().unwrap_or_default(),
                "uot": true
            }]
        }),
        other => json!({ "_unsupported": other }),
    };

    let stream = if protocol == "shadowsocks" {
        json!({ "network": "tcp", "security": "none" })
    } else {
        json!({
            "network": "ws",
            "security": "tls",
            "tlsSettings": {
                "serverName": ep.sni.clone().unwrap_or_default(),
                "fingerprint": hard.utls_profile
            },
            "wsSettings": {
                "path": format!("{}{}", ep.path.clone().unwrap_or_default(), padding_query(hard)),
                "headers": { "Host": ep.host.clone().unwrap_or_default() }
            }
        })
    };

    let proxy = json!({
        "tag": format!("proxy-{}", ep.tag),
        "protocol": protocol,
        "settings": settings,
        "streamSettings": stream
    });
    full_config(vec![proxy], hard)
}

fn padding_query(hard: &HardeningOptions) -> String {
    if hard.padding_bytes > 0 {
        format!("?pad={}", hard.padding_bytes)
    } else {
        String::new()
    }
}

/// The shared skeleton: inbounds (SOCKS+HTTP on localhost), hardened DNS,
/// routing (IR domestic + private → DIRECT, everything else → first proxy).
/// First outbound is the Xray default route (the proxy).
fn full_config(mut proxies: Vec<Value>, hard: &HardeningOptions) -> Value {
    let dns = match hard.dns_mode {
        DnsMode::DomesticDirect => json!({
            "servers": [
                { "address": "78.157.42.100", "domains": ["geosite:category-ir"] },
                { "address": "1.1.1.1" }
            ]
        }),
        DnsMode::Dot => json!({
            "servers": [ { "address": "1.1.1.1", "port": 853 } ]
        }),
        DnsMode::Doh => json!({
            "servers": [
                "https://1.1.1.1/dns-query",
                { "address": "78.157.42.100", "domains": ["geosite:category-ir"] }
            ]
        }),
        DnsMode::BootstrapIps => json!({
            "servers": [
                { "address": "10.202.10.202", "domains": ["geosite:category-ir"] },
                { "address": "8.8.8.8" }
            ]
        }),
    };

    let direct = json!({
        "tag": "direct-ir",
        "protocol": "freedom",
        "settings": { "domainStrategy": "UseIP" }
    });
    let mut outbounds = Vec::with_capacity(proxies.len() + 1);
    outbounds.append(&mut proxies);
    outbounds.push(direct);

    json!({
        "log": { "loglevel": "warning" },
        "dns": dns,
        "inbounds": [
            {
                "tag": "socks",
                "port": SOCKS_INBOUND_PORT,
                "listen": "127.0.0.1",
                "protocol": "socks",
                "settings": { "udp": true, "auth": "noauth" },
                "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
            },
            {
                "tag": "http",
                "port": HTTP_INBOUND_PORT,
                "listen": "127.0.0.1",
                "protocol": "http",
                "settings": {},
                "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
            }
        ],
        "outbounds": outbounds,
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": [
                { "type": "field", "outboundTag": "direct-ir", "domain": ["geosite:category-ir", "domain:ir"] },
                { "type": "field", "outboundTag": "direct-ir", "ip": ["geoip:ir", "geoip:private"] }
            ]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reality_ep() -> ProfileEndpoint {
        ProfileEndpoint {
            tag: "fra".into(),
            address: "198.51.100.7".into(),
            port: 443,
            uuid: "11111111-2222-4333-8444-555566667777".into(),
            sni: Some("www.microsoft.com".into()),
            public_key: Some("SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc".into()),
            short_id: Some("0123456789abcdef".into()),
            path: None,
            host: None,
            password: None,
            encryption: None,
        }
    }

    #[test]
    fn reality_config_is_valid_structure() {
        let cfg = build_vless_config(&reality_ep(), &HardeningOptions::default());
        let out = cfg["outbounds"].as_array().expect("outbounds must be array");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["protocol"], "vless");
        assert_eq!(out[0]["streamSettings"]["security"], "reality");
        assert_eq!(out[0]["settings"]["vnext"][0]["users"][0]["flow"], "xtls-rprx-vision");
        assert_eq!(cfg["inbounds"][0]["port"], serde_json::json!(SOCKS_INBOUND_PORT));
        assert_eq!(out[1]["tag"], "direct-ir");
        // Iran domestic stays direct.
        assert!(cfg["routing"]["rules"][0]["domain"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d == "geosite:category-ir"));
    }

    #[test]
    fn ws_cdn_config_carries_padding_and_mux_when_hardened() {
        let ep = ProfileEndpoint {
            tag: "cdn".into(),
            address: "cdn.example.org".into(),
            port: 443,
            uuid: "11111111-2222-4333-8444-555566667777".into(),
            sni: Some("cdn.example.org".into()),
            public_key: None,
            short_id: None,
            path: Some("/vorws".into()),
            host: Some("cdn.example.org".into()),
            password: None,
            encryption: None,
        };
        let hard = HardeningOptions {
            padding_bytes: 64,
            mux_concurrency: Some(4),
            ..Default::default()
        };
        let cfg = build_vless_config(&ep, &hard);
        let path = cfg["outbounds"][0]["streamSettings"]["wsSettings"]["path"]
            .as_str()
            .unwrap();
        assert!(path.contains("pad=64"), "path: {path}");
        assert_eq!(cfg["outbounds"][0]["mux"]["enabled"], true);
        assert_eq!(cfg["outbounds"][0]["mux"]["concurrency"], 4);
    }

    #[test]
    fn ss2022_has_no_tls_and_vmess_has_ws() {
        let ss = ProfileEndpoint {
            tag: "ss".into(),
            address: "198.51.100.9".into(),
            port: 8388,
            uuid: String::new(),
            sni: None,
            public_key: None,
            short_id: None,
            path: None,
            host: None,
            password: Some("YWJjY2Q=:cGFzcw==".into()),
            encryption: Some("2022-blake3-aes-128-gcm".into()),
        };
        let cfg = build_generic_config("shadowsocks", &ss, &HardeningOptions::default());
        assert_eq!(cfg["outbounds"][0]["streamSettings"]["security"], "none");

        let vm = ProfileEndpoint {
            uuid: "11111111-2222-4333-8444-555566667777".into(),
            path: Some("/ws".into()),
            ..ss
        };
        let cfg = build_generic_config("vmess", &vm, &HardeningOptions::default());
        assert_eq!(cfg["outbounds"][0]["protocol"], "vmess");
        assert_eq!(cfg["outbounds"][0]["streamSettings"]["network"], "ws");
    }

    #[test]
    fn bootstrap_dns_in_blackout_mode() {
        let hard = HardeningOptions {
            dns_mode: DnsMode::BootstrapIps,
            blackout: true,
            ..Default::default()
        };
        let cfg = build_vless_config(&reality_ep(), &hard);
        assert_eq!(cfg["dns"]["servers"][0]["address"], "10.202.10.202");
    }

    #[test]
    fn config_serializes_roundtrip() {
        let cfg = build_vless_config(&reality_ep(), &HardeningOptions::default());
        let s = serde_json::to_string(&cfg).unwrap();
        let back: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(back, cfg);
    }
}
