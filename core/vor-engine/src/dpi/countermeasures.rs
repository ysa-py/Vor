use serde::{Deserialize, Serialize};

use super::model::DpiClass;
use super::features::DpiFeatures;

/// Concrete evasion countermeasures the engine can order.
///
/// These map 1:1 onto Xray-core transport settings and the platform-specific
/// raw-socket layer (goodbyeDPI-style fragmentation on Windows/OpenWrt,
/// VpnService path-MTU tricks on Android).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Countermeasure {
    /// Split the TLS ClientHello at byte offset N (classic DPI-break, SNI-field split).
    ClientHelloSplit { at_byte: u16 },
    /// Fragment outgoing packets to MSS size (avoids pattern matching on full frames).
    PacketFragmentation { mss: u16 },
    /// Rotate the uTLS ClientHello fingerprint (chrome/ios/firefox/safari/randomized).
    UtlsFingerprint { profile: String },
    /// Send the real SNI only in the TLS inner layer; outer hello uses a fronted domain.
    FakeSni { front_domain: String },
    /// Add noise padding to early payload bytes (defeats length-based classifiers).
    Padding { bytes: u16 },
    /// Enable Xmux multiplexing (single handshake — fewer DPI samples per session).
    Mux { max_concurrency: u8 },
    /// Periodically hop the tunnel port within a range (defeats port-based blocks).
    PortHopping { interval_secs: u16, range: String },
    /// Switch DNS strategy (leak-proof bootstrap when international DNS is hijacked).
    DnsMode { mode: DnsMode },
    /// Escalate to the next transport class (Reality → CDN → ...).
    TransportSwitch { to: String },
    /// Full blackout mode: CDN-only endpoints + domestic bootstrap DNS + aggressive split.
    BlackoutMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DnsMode {
    /// Plain UDP DNS only for Iranian domestic domains (must stay direct).
    DomesticDirect,
    /// DNS-over-TLS to a reachable resolver.
    Dot,
    /// DNS-over-HTTPS (survives UDP:53 hijack).
    Doh,
    /// Hard-coded bootstrap IPs (no DNS dependency for first connect).
    BootstrapIps,
}

/// Ordered plan with the reasoning preserved for UI/diagnostics display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountermeasurePlan {
    pub triggered_by: DpiClass,
    pub actions: Vec<Countermeasure>,
    pub explanations: Vec<String>,
}

/// Decide the countermeasure plan. Deterministic, explainable, escalating.
pub fn plan_for(class: DpiClass, features: &DpiFeatures) -> CountermeasurePlan {
    let f = features.sanitized();
    let (mut actions, mut explanations) = (Vec::new(), Vec::new());

    match class {
        DpiClass::Benign => {
            actions.push(Countermeasure::UtlsFingerprint {
                profile: "chrome".into(),
            });
            explanations
                .push("channel clean: standard uTLS camouflage only".into());
        }
        DpiClass::Throttling => {
            if f.timing_regularity > 0.5 {
                actions.push(Countermeasure::Padding { bytes: 64 });
                explanations
                    .push("periodic shaping detected → payload padding blurs length signature".into());
            }
            actions.push(Countermeasure::Mux { max_concurrency: 4 });
            explanations
                .push("throttle suspected → mux reduces per-flow fingerprints".into());
            actions.push(Countermeasure::PortHopping {
                interval_secs: 45,
                range: "10000-20000".into(),
            });
            explanations
                .push("rate-limited port profile → port hopping escapes per-port QoS".into());
        }
        DpiClass::ActiveDpi => {
            actions.push(Countermeasure::ClientHelloSplit { at_byte: 7 });
            explanations
                .push("active SNI inspection → ClientHello split at byte 7 breaks reassembly".into());
            actions.push(Countermeasure::UtlsFingerprint {
                profile: "randomized".into(),
            });
            explanations
                .push("fingerprint pinning detected → randomized uTLS profile".into());
            actions.push(Countermeasure::PacketFragmentation { mss: 48 });
            explanations.push("RST injection pattern → aggressive fragmentation".into());
            if f.reset_after_client_hello > 0.4 {
                actions.push(Countermeasure::FakeSni {
                    front_domain: "cdn.jsdelivr.net".into(),
                });
                explanations
                    .push("SNI-based reset → fronted domain masks the real destination".into());
            }
            actions.push(Countermeasure::TransportSwitch {
                to: "ws_tls_cdn".into(),
            });
            explanations
                .push("hostile in-path box → escalate to CDN-routed transport".into());
        }
    }

    CountermeasurePlan {
        triggered_by: class,
        actions,
        explanations,
    }
}

/// Blackout mode plan — used when international connectivity collapses
/// (domestic-only routing): CDN transports + hard DNS bootstrap.
pub fn blackout_plan() -> CountermeasurePlan {
    CountermeasurePlan {
        triggered_by: DpiClass::ActiveDpi,
        actions: vec![
            Countermeasure::BlackoutMode,
            Countermeasure::DnsMode {
                mode: DnsMode::BootstrapIps,
            },
            Countermeasure::ClientHelloSplit { at_byte: 5 },
            Countermeasure::PacketFragmentation { mss: 40 },
            Countermeasure::TransportSwitch {
                to: "ws_tls_cdn".into(),
            },
        ],
        explanations: vec![
            "international blackout detected → CDN-fronted transports only".into(),
            "DNS hard-bootstrap avoids hijacked resolvers".into(),
            "aggressive fragmentation for in-country DPI boxes".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f() -> DpiFeatures {
        DpiFeatures {
            rtt_variance: 0.2,
            rst_rate: 0.1,
            handshake_fail_ratio: 0.2,
            reset_after_client_hello: 0.6,
            payload_entropy: 0.7,
            timing_regularity: 0.8,
            throttle_ratio: 0.3,
            probe_hit_rate: 0.1,
        }
    }

    #[test]
    fn benign_plan_is_light() {
        let p = plan_for(DpiClass::Benign, &f());
        assert_eq!(p.actions.len(), 1);
    }

    #[test]
    fn active_dpi_plan_escalinates() {
        let p = plan_for(DpiClass::ActiveDpi, &f());
        assert!(p
            .actions
            .iter()
            .any(|a| matches!(a, Countermeasure::ClientHelloSplit { .. })));
        assert!(p
            .actions
            .iter()
            .any(|a| matches!(a, Countermeasure::TransportSwitch { .. })));
        assert_eq!(p.actions.len(), p.explanations.len());
    }

    #[test]
    fn blackout_plan_is_self_sufficient() {
        let p = blackout_plan();
        assert!(p
            .actions
            .iter()
            .any(|a| matches!(a, Countermeasure::DnsMode { mode: DnsMode::BootstrapIps })));
    }
}
