use serde::{Deserialize, Serialize};

use crate::metrics::EndpointHealth;

/// Transport classes ordered by general resilience profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportClass {
    /// VLESS + Reality + uTLS (direct TCP:443 impersonation).
    RealityDirect,
    /// VLESS/VMess + WS + TLS via CDN (blackout-resilient).
    WsTlsCdn,
    /// gRPC multiplexed TLS.
    GrpcTls,
    /// HTTPUpgrade behind CDN.
    HttpUpgradeCdn,
    /// Shadowsocks-2022 ( UDP-friendly fallback).
    Ss2022,
}

impl TransportClass {
    pub const FALLBACK_LADDER: [TransportClass; 5] = [
        TransportClass::RealityDirect,
        TransportClass::WsTlsCdn,
        TransportClass::GrpcTls,
        TransportClass::HttpUpgradeCdn,
        TransportClass::Ss2022,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            TransportClass::RealityDirect => "reality_direct",
            TransportClass::WsTlsCdn => "ws_tls_cdn",
            TransportClass::GrpcTls => "grpc_tls",
            TransportClass::HttpUpgradeCdn => "httpupgrade_cdn",
            TransportClass::Ss2022 => "ss2022",
        }
    }
}

/// Explainable, deterministic endpoint score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionExplanation {
    pub endpoint_id: String,
    pub transport: TransportClass,
    pub score: f32,
    /// Human-readable reasons, e.g. "latency 38ms (excellent)".
    pub reasons: Vec<String>,
}

const W_LATENCY: f32 = 0.40;
const W_JITTER: f32 = 0.15;
const W_LOSS: f32 = 0.25;
const W_STABILITY: f32 = 0.20;

/// Score an endpoint in 0..=100 with fully explainable components.
///
/// Selection logic is transparent by design: the UI can display exactly why a
/// transport/endpoint was chosen ("lower latency, fewer recent failures").
pub fn score_endpoint(h: &EndpointHealth, transport: TransportClass) -> DecisionExplanation {
    let lat = h.mean_latency();
    let jit = h.jitter();

    // Latency component: 30ms→1.0, 300ms→0.33, 1000ms+→~0.1
    let lat_score = 1.0 / (1.0 + lat / 200.0);
    let jit_score = 1.0 / (1.0 + jit / 40.0);
    let loss_score = (1.0 - h.loss_pct / 100.0).clamp(0.0, 1.0);
    let stability = if h.fail_streak == 0 {
        1.0
    } else {
        (1.0 - h.fail_streak as f32 * 0.25).max(0.0)
    };

    let mut score = 100.0
        * (W_LATENCY * lat_score
            + W_JITTER * jit_score
            + W_LOSS * loss_score
            + W_STABILITY * stability);

    // Measured penalties (deterministic, explainable).
    let mut reasons = Vec::new();
    if lat < 80.0 {
        reasons.push(format!("latency {lat:.0}ms (excellent)"));
    } else if lat < 200.0 {
        reasons.push(format!("latency {lat:.0}ms (acceptable)"));
    } else {
        reasons.push(format!("latency {lat:.0}ms (poor, penalized)"));
        score *= 0.9;
    }
    if h.fail_streak >= 2 {
        reasons.push(format!("{} consecutive failures, penalized", h.fail_streak));
        score -= 10.0 * h.fail_streak.min(5) as f32;
    }
    if h.cdn_routed {
        reasons.push("CDN-routed: resilient to international blackouts".into());
        // CDN routes are slightly preferred when international links degrade;
        // the controller applies this contextually, small static bonus here.
        score *= 1.05;
    }
    reasons.push(format!("loss {:.1}%, jitter {jit:.1}ms", h.loss_pct));

    DecisionExplanation {
        endpoint_id: h.endpoint_id.clone(),
        transport,
        score: score.clamp(0.0, 100.0),
        reasons,
    }
}

/// Pick the best (endpoint, transport) pair deterministically.
pub fn pick_best(
    candidates: &[(EndpointHealth, TransportClass)],
) -> Option<DecisionExplanation> {
    let mut scored: Vec<DecisionExplanation> = candidates
        .iter()
        .map(|(h, t)| score_endpoint(h, *t))
        .collect();
    // Deterministic tie-break: higher score, then lexicographically smaller id.
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.endpoint_id.cmp(&b.endpoint_id))
    });
    scored.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health(id: &str, lats: &[f32], fails: u32, cdn: bool) -> EndpointHealth {
        let mut h = EndpointHealth::new(id, cdn);
        for l in lats {
            h.push_latency(*l);
        }
        for _ in 0..fails {
            h.record_failure(0);
        }
        h
    }

    #[test]
    fn prefers_low_latency_stable_endpoint() {
        let good = health("fra-04", &[30.0, 32.0, 31.0], 0, false);
        let bad = health("dus-01", &[280.0, 310.0, 295.0], 3, false);
        let best = pick_best(&[
            (good.clone(), TransportClass::RealityDirect),
            (bad.clone(), TransportClass::WsTlsCdn),
        ])
        .unwrap();
        assert_eq!(best.endpoint_id, "fra-04");
        assert!(best.score > 60.0);
    }

    #[test]
    fn scoring_is_deterministic_and_explained() {
        let h = health("ams-02", &[50.0, 55.0], 0, true);
        let a = score_endpoint(&h, TransportClass::WsTlsCdn);
        let b = score_endpoint(&h, TransportClass::WsTlsCdn);
        assert_eq!(a.score, b.score);
        assert!(!a.reasons.is_empty());
    }

    #[test]
    fn fallback_ladder_is_ordered() {
        assert_eq!(TransportClass::FALLBACK_LADDER[0], TransportClass::RealityDirect);
        assert_eq!(
            TransportClass::FALLBACK_LADDER[4],
            TransportClass::Ss2022
        );
    }
}
