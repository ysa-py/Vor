//! Subscription / share-link parsing (vless:// vmess:// trojan:// ss://) and
//! full base64 subscription lists. 100% local — QR import/export is generated
//! on-device, never via web services.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::xray::ProfileEndpoint;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedProfile {
    pub protocol: String, // vless | vmess | trojan | shadowsocks
    pub endpoint: ProfileEndpoint,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParseError {
    Empty,
    UnsupportedScheme(String),
    Malformed(String),
}

fn b64_decode_forgiving(s: &str) -> Result<Vec<u8>, ParseError> {
    let cleaned: String = s.trim().replace(['\n', '\r', ' '], "");
    for engine in [
        &base64::engine::general_purpose::STANDARD,
        &base64::engine::general_purpose::STANDARD_NO_PAD,
        &base64::engine::general_purpose::URL_SAFE,
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
    ] {
        if let Ok(bytes) = engine.decode(cleaned.as_bytes()) {
            return Ok(bytes);
        }
    }
    Err(ParseError::Malformed("base64".into()))
}

/// Parse one share link.
pub fn parse_link(link: &str) -> Result<ParsedProfile, ParseError> {
    let link = link.trim();
    if link.is_empty() {
        return Err(ParseError::Empty);
    }
    if let Some(rest) = link.strip_prefix("vless://") {
        parse_vless(rest)
    } else if let Some(rest) = link.strip_prefix("vmess://") {
        parse_vmess(rest)
    } else if let Some(rest) = link.strip_prefix("trojan://") {
        parse_trojan(rest)
    } else if let Some(rest) = link.strip_prefix("ss://") {
        parse_ss(rest)
    } else {
        let scheme: String = link.split("://").next().unwrap_or("").into();
        Err(ParseError::UnsupportedScheme(scheme))
    }
}

/// Parse a whole subscription payload: base64 blob OR newline-separated links.
pub fn parse_subscription(payload: &str) -> Vec<Result<ParsedProfile, ParseError>> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return vec![Err(ParseError::Empty)];
    }
    let text = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        match b64_decode_forgiving(trimmed) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(e) => return vec![Err::<ParsedProfile, _>(e)],
        }
    };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(parse_link)
        .collect()
}

fn split_query(fragment: &str) -> (String, Vec<(String, String)>) {
    let (main, _fragment) = match fragment.split_once('#') {
        Some((m, f)) => (m.to_string(), Some(f.to_string())),
        None => (fragment.to_string(), None::<String>),
    };
    let (authority, qs) = match main.split_once('?') {
        Some((a, q)) => (a.to_string(), Some(q)),
        None => (main, None),
    };
    let mut params = Vec::new();
    if let Some(qs) = qs {
        for pair in qs.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                params.push((k.to_string(), urldecode(v)));
            }
        }
    }
    (authority, params)
}

fn urldecode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 1 && i + 2 <= bytes.len() - 1 + 1
            && (i + 2 < bytes.len() || i + 2 == bytes.len()) {
                if let (Some(h), Some(l)) = (
                    bytes.get(i + 1).and_then(|c| (*c as char).to_digit(16)),
                    bytes.get(i + 2).and_then(|c| (*c as char).to_digit(16)),
                ) {
                    out.push(((h << 4) | l) as u8);
                    i += 3;
                    continue;
                }
            }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query_get<'a>(params: &'a [(String, String)], key: &str) -> Option<&'a str> {
    params.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn parse_vless(rest: &str) -> Result<ParsedProfile, ParseError> {
    let (authority, params) = split_query(rest);
    let (userinfo, hostport) = authority
        .split_once('@')
        .ok_or_else(|| ParseError::Malformed("vless missing @".into()))?;
    let (host, port) = parse_host_port(hostport)?;
    Ok(ParsedProfile {
        protocol: "vless".into(),
        endpoint: ProfileEndpoint {
            tag: "vless".into(),
            address: host,
            port,
            uuid: urldecode(userinfo),
            sni: query_get(&params, "sni").map(String::from),
            public_key: query_get(&params, "pbk").map(String::from),
            short_id: query_get(&params, "sid").map(String::from),
            path: query_get(&params, "path").map(String::from),
            host: query_get(&params, "host").map(String::from),
            password: None,
            encryption: None,
        },
        raw: format!("vless://{rest}"),
    })
}

fn parse_vmess(rest: &str) -> Result<ParsedProfile, ParseError> {
    let bytes = b64_decode_forgiving(rest)?;
    let text = String::from_utf8_lossy(&bytes);
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| ParseError::Malformed(format!("vmess json: {e}")))?;
    let addr = v
        .get("add")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::Malformed("vmess add".into()))?
        .to_string();
    let port = v
        .get("port")
        .and_then(|p| match p {
            Value::Number(n) => n.as_u64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .ok_or_else(|| ParseError::Malformed("vmess port".into()))? as u16;
    Ok(ParsedProfile {
        protocol: "vmess".into(),
        endpoint: ProfileEndpoint {
            tag: "vmess".into(),
            address: addr,
            port,
            uuid: v.get("id").and_then(Value::as_str).unwrap_or_default().into(),
            sni: v.get("sni").and_then(Value::as_str).map(String::from),
            public_key: None,
            short_id: None,
            path: v.get("path").and_then(Value::as_str).map(String::from),
            host: v.get("host").and_then(Value::as_str).map(String::from),
            password: None,
            encryption: v.get("scy").and_then(Value::as_str).map(String::from),
        },
        raw: format!("vmess://{rest}"),
    })
}

fn parse_trojan(rest: &str) -> Result<ParsedProfile, ParseError> {
    let (authority, params) = split_query(rest);
    let (userinfo, hostport) = authority
        .split_once('@')
        .ok_or_else(|| ParseError::Malformed("trojan missing @".into()))?;
    let (host, port) = parse_host_port(hostport)?;
    Ok(ParsedProfile {
        protocol: "trojan".into(),
        endpoint: ProfileEndpoint {
            tag: "trojan".into(),
            address: host,
            port,
            uuid: String::new(),
            sni: query_get(&params, "sni").map(String::from),
            public_key: None,
            short_id: None,
            path: query_get(&params, "path").map(String::from),
            host: query_get(&params, "host").map(String::from),
            password: Some(urldecode(userinfo)),
            encryption: None,
        },
        raw: format!("trojan://{rest}"),
    })
}

fn parse_ss(rest: &str) -> Result<ParsedProfile, ParseError> {
    // SIP002: ss://base64(method:password)@host:port or ss://base64(method:password@host:port)
    let (main, _tag) = match rest.split_once('#') {
        Some((m, t)) => (m.to_string(), Some(t.to_string())),
        None => (rest.to_string(), None),
    };
    if let Some((userinfo, hostport)) = main.split_once('@') {
        let decoded = b64_decode_forgiving(userinfo)?;
        let cred = String::from_utf8_lossy(&decoded).to_string();
        let (method, password) = cred
            .split_once(':')
            .ok_or_else(|| ParseError::Malformed("ss cred".into()))?;
        let (host, port) = parse_host_port(hostport)?;
        Ok(ParsedProfile {
            protocol: "shadowsocks".into(),
            endpoint: ProfileEndpoint {
                tag: "ss".into(),
                address: host,
                port,
                uuid: String::new(),
                sni: None,
                public_key: None,
                short_id: None,
                path: None,
                host: None,
                password: Some(password.to_string()),
                encryption: Some(method.to_string()),
            },
            raw: format!("ss://{rest}"),
        })
    } else {
        let decoded = b64_decode_forgiving(&main)?;
        let all = String::from_utf8_lossy(&decoded).to_string();
        let (cred, hostport) = all
            .split_once('@')
            .ok_or_else(|| ParseError::Malformed("ss missing @".into()))?;
        let (method, password) = cred
            .split_once(':')
            .ok_or_else(|| ParseError::Malformed("ss cred".into()))?;
        let (host, port) = parse_host_port(hostport)?;
        Ok(ParsedProfile {
            protocol: "shadowsocks".into(),
            endpoint: ProfileEndpoint {
                tag: "ss".into(),
                address: host,
                port,
                uuid: String::new(),
                sni: None,
                public_key: None,
                short_id: None,
                path: None,
                host: None,
                password: Some(password.to_string()),
                encryption: Some(method.to_string()),
            },
            raw: format!("ss://{rest}"),
        })
    }
}

fn parse_host_port(s: &str) -> Result<(String, u16), ParseError> {
    let s = s.trim_end_matches('/');
    let (host, port_str) = s
        .rsplit_once(':')
        .ok_or_else(|| ParseError::Malformed("host:port".into()))?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| ParseError::Malformed("port".into()))?;
    Ok((host.trim_matches(|c| c == '[' || c == ']').to_string(), port))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VLESS_REALITY: &str = "vless://11111111-2222-4333-8444-555566667777@198.51.100.7:443?type=tcp&security=reality&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=0123456789abcdef&sni=www.microsoft.com&flow=xtls-rprx-vision#VOR-FRA";

    #[test]
    fn parses_vless_reality() {
        let p = parse_link(VLESS_REALITY).unwrap();
        assert_eq!(p.protocol, "vless");
        assert_eq!(p.endpoint.address, "198.51.100.7");
        assert_eq!(p.endpoint.port, 443);
        assert_eq!(p.endpoint.public_key.as_deref(), Some("SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc"));
        assert_eq!(p.endpoint.sni.as_deref(), Some("www.microsoft.com"));
    }

    #[test]
    fn parses_vmess_base64() {
        use base64::Engine;
        let doc = serde_json::json!({
            "v": "2", "ps": "test", "add": "cdn.example.org", "port": "443",
            "id": "11111111-2222-4333-8444-555566667777", "aid": "0",
            "net": "ws", "path": "/vor", "host": "cdn.example.org", "tls": "tls", "scy": "auto"
        });
        let b64 = base64::engine::general_purpose::STANDARD.encode(doc.to_string());
        let p = parse_link(&format!("vmess://{b64}")).unwrap();
        assert_eq!(p.protocol, "vmess");
        assert_eq!(p.endpoint.address, "cdn.example.org");
        assert_eq!(p.endpoint.port, 443);
        assert_eq!(p.endpoint.path.as_deref(), Some("/vor"));
    }

    #[test]
    fn parses_trojan_and_ss() {
        let t = parse_link("trojan://pass%40word@198.51.100.10:443?sni=example.com#T").unwrap();
        assert_eq!(t.endpoint.password.as_deref(), Some("pass@word"));
        assert_eq!(t.endpoint.port, 443);

        let s = parse_link("ss://YWVzLTI1Ni1nY206c2VjcmV0@198.51.100.11:8388#SS").unwrap();
        assert_eq!(s.protocol, "shadowsocks");
        assert_eq!(s.endpoint.encryption.as_deref(), Some("aes-256-gcm"));
        assert_eq!(s.endpoint.password.as_deref(), Some("secret"));
    }

    #[test]
    fn subscription_base64_list_and_rejects_garbage() {
        use base64::Engine;
        let list = format!("{VLESS_REALITY}\ntrojan://pw@198.51.100.10:443#T2\n");
        let b64 = base64::engine::general_purpose::STANDARD.encode(&list);
        let parsed = parse_subscription(&b64);
        assert_eq!(parsed.len(), 2);
        assert!(parsed[0].is_ok() && parsed[1].is_ok());

        let bad = parse_subscription("not a link");
        assert!(bad.iter().all(|r| r.is_err()));
        assert!(parse_subscription("").iter().all(|r| matches!(r, Err(ParseError::Empty))));
    }

    #[test]
    fn fuzzish_inputs_never_panic() {
        let inputs = [
            "vless://", "vless://@", "vmess://####", "ss://", "ss://@@@",
            "trojan://@", "vless://a@b:notaport", "\u{0}\u{1}\u{2}",
            "vmess://e30=", // "{}"
        ];
        for i in inputs {
            let _ = parse_link(i); // must return Err, never panic
        }
    }
}
