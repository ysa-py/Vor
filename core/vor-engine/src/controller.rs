//! The adaptive connection controller: bounded retries, exponential backoff,
//! transport fallback ladder, blackout mode, explainable event log.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::dpi::countermeasures::{plan_for, Countermeasure, CountermeasurePlan};
use crate::dpi::features::DpiFeatures;
use crate::dpi::model::{classify, DpiClass};
use crate::metrics::EndpointHealth;
use crate::scoring::{pick_best, TransportClass};

pub const MAX_ATTEMPTS: u32 = 5;
pub const BASE_BACKOFF_MS: u64 = 500;
pub const MAX_BACKOFF_MS: u64 = 8_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailClass {
    None,
    DnsFailure,
    HandshakeTimeout,
    ResetByPeer,
    TlsBlocked,
    BlackoutSuspected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineEvent {
    pub ts: i64,
    pub stage: String,
    pub level: String, // info | warn | error
    pub message: String,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRequest {
    /// Candidate endpoints with measured health.
    pub endpoints: Vec<EndpointCandidate>,
    /// Live DPI features from the previous attempt (zeros on first connect).
    pub dpi_features: DpiFeatures,
    /// Last failure classification (None on first connect).
    pub last_failure: FailClass,
    /// Attempt number of THIS plan (0-based; controller refuses > MAX_ATTEMPTS).
    pub attempt: u32,
    /// When true, international connectivity is believed severed → blackout mode.
    pub intl_blackout: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointCandidate {
    pub id: String,
    pub health: EndpointHealth,
    pub transport: TransportClass,
}

/// The controller's decision for one connection attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionPlan {
    pub selected_endpoint: String,
    pub transport: TransportClass,
    pub countermeasures: CountermeasurePlan,
    pub backoff_ms: u64,
    pub next_failure_hint: FailClass,
    pub events: Vec<EngineEvent>,
    /// False only when the bounded-retry budget is exhausted (never loops forever).
    pub may_proceed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectResult {
    pub plan: ConnectionPlan,
}

/// Pure decision function: (network state + history) → next attempt plan.
/// The platform layer executes it and reports outcomes; this keeps the logic
/// 100% testable without real sockets.
pub fn connect(req: &ConnectRequest) -> ConnectResult {
    let mut events = Vec::new();
    let mut ev = |stage: &str, level: &str, message: String| {
        events.push(EngineEvent {
            ts: now(),
            stage: stage.into(),
            level: level.into(),
            message,
        });
    };

    // Bounded retries — no infinite loops, ever.
    if req.attempt >= MAX_ATTEMPTS {
        ev("controller", "error", "retry budget exhausted (5 attempts) → fail-closed, user informed".into());
        return ConnectResult {
            plan: ConnectionPlan {
                selected_endpoint: "none".into(),
                transport: TransportClass::RealityDirect,
                countermeasures: plan_for(DpiClass::Benign, &req.dpi_features),
                backoff_ms: MAX_BACKOFF_MS,
                next_failure_hint: FailClass::None,
                events,
                may_proceed: false,
            },
        };
    }

    // 1) Exponential backoff for this attempt (bounded): 500ms·2^n capped at 8s.
    let backoff = BASE_BACKOFF_MS
        .saturating_mul(2u64.saturating_pow(req.attempt.min(4)))
        .min(MAX_BACKOFF_MS);

    // 2) Blackout handling — international cut → CDN-only + DNS bootstrap.
    if req.intl_blackout {
        ev("blackout", "warn", "international blackout suspected → blackout strategy engaged".into());
        let cdn_candidates: Vec<(EndpointHealth, TransportClass)> = req
            .endpoints
            .iter()
            .filter(|c| c.health.cdn_routed)
            .map(|c| (c.health.clone(), c.transport))
            .collect();
        let (health, transport) = match pick_best(&cdn_candidates) {
            Some(best) => {
                let h = cdn_candidates
                    .iter()
                    .find(|(h, _)| h.endpoint_id == best.endpoint_id)
                    .map(|(h, _)| h.clone())
                    .expect("scored candidate exists");
                ev("blackout", "info", format!("CDN candidate selected: {}", h.endpoint_id));
                (h, best.transport)
            }
            None => {
                ev("blackout", "error", "no CDN-routed candidate available → default CDN fallback".into());
                (EndpointHealth::new("cdn-fallback", true), TransportClass::WsTlsCdn)
            }
        };
        return ConnectResult {
            plan: ConnectionPlan {
                selected_endpoint: health.endpoint_id,
                transport,
                countermeasures: crate::dpi::countermeasures::blackout_plan(),
                backoff_ms: backoff,
                next_failure_hint: FailClass::BlackoutSuspected,
                events,
                may_proceed: true,
            },
        };
    }

    // 3) Failure classification → contextual strategy.
    match req.last_failure {
        FailClass::DnsFailure => ev("dns", "warn", "DNS failure → switching to hard bootstrap IPs".into()),
        FailClass::TlsBlocked => ev("tls", "warn", "TLS blocked → escalating evasion pressure".into()),
        FailClass::ResetByPeer => ev("tcp", "warn", "RST storm → fragmentation countermeasures".into()),
        FailClass::HandshakeTimeout => ev("handshake", "warn", "handshake timeout → endpoint re-scoring".into()),
        FailClass::BlackoutSuspected => ev("blackout", "warn", "blackout classifier will re-evaluate on next tick".into()),
        FailClass::None => {}
    }

    // 4) Real DPI inference on live features.
    let verdict = classify(&req.dpi_features);
    ev(
        "dpi",
        "info",
        format!(
            "model v{} → class={} confidence={:.2}",
            verdict.model_version, verdict.class.as_str(), verdict.confidence
        ),
    );

    // 5) Deterministic endpoint scoring.
    let candidates: Vec<(EndpointHealth, TransportClass)> = req
        .endpoints
        .iter()
        .map(|c| (c.health.clone(), c.transport))
        .collect();
    let best = match pick_best(&candidates) {
        Some(b) => b,
        None => {
            ev("scoring", "error", "no candidate endpoints available".into());
            return ConnectResult {
                plan: ConnectionPlan {
                    selected_endpoint: "none".into(),
                    transport: TransportClass::RealityDirect,
                    countermeasures: plan_for(DpiClass::Benign, &req.dpi_features),
                    backoff_ms: backoff,
                    next_failure_hint: FailClass::None,
                    events,
                    may_proceed: false,
                },
            };
        }
    };
    ev(
        "scoring",
        "info",
        format!(
            "selected {} via {} (score {:.1}) — {}",
            best.endpoint_id,
            best.transport.as_str(),
            best.score,
            best.reasons.join("; ")
        ),
    );

    // 6) Countermeasures mapped from the DPI verdict.
    let countermeasures = plan_for(verdict.class, &req.dpi_features);
    for e in &countermeasures.explanations {
        ev("countermeasure", "info", e.clone());
    }

    // 7) Escalate transport when active DPI is confident.
    let transport = if verdict.class == DpiClass::ActiveDpi && best.transport == TransportClass::RealityDirect {
        ev("transport", "warn", "active DPI → escalating Reality → CDN transport".into());
        TransportClass::WsTlsCdn
    } else {
        best.transport
    };

    let hint = match req.last_failure {
        FailClass::DnsFailure => FailClass::DnsFailure,
        _ if verdict.class == DpiClass::ActiveDpi => FailClass::TlsBlocked,
        _ => FailClass::None,
    };

    ConnectResult {
        plan: ConnectionPlan {
            selected_endpoint: best.endpoint_id,
            transport,
            countermeasures,
            backoff_ms: backoff,
            next_failure_hint: hint,
            events,
            may_proceed: true,
        },
    }
}

/// Apply plan countermeasures to an endpoint id list (helper for UI display).
pub fn describe_plan(plan: &ConnectionPlan) -> Vec<String> {
    plan.countermeasures
        .actions
        .iter()
        .map(|a| match a {
            Countermeasure::ClientHelloSplit { at_byte } => format!("ClientHello split @ {at_byte}"),
            Countermeasure::PacketFragmentation { mss } => format!("packet fragmentation MSS={mss}"),
            Countermeasure::UtlsFingerprint { profile } => format!("uTLS {profile}"),
            Countermeasure::FakeSni { front_domain } => format!("fronted SNI {front_domain}"),
            Countermeasure::Padding { bytes } => format!("padding {bytes}B"),
            Countermeasure::Mux { max_concurrency } => format!("mux ×{max_concurrency}"),
            Countermeasure::PortHopping { interval_secs, range } => {
                format!("port hop {range} / {interval_secs}s")
            }
            Countermeasure::DnsMode { mode } => format!(
                "DNS {}",
                match mode {
                    crate::dpi::countermeasures::DnsMode::DomesticDirect => "domestic-direct",
                    crate::dpi::countermeasures::DnsMode::Dot => "DoT",
                    crate::dpi::countermeasures::DnsMode::Doh => "DoH",
                    crate::dpi::countermeasures::DnsMode::BootstrapIps => "bootstrap-IPs",
                }
            ),
            Countermeasure::TransportSwitch { to } => format!("transport → {to}"),
            Countermeasure::BlackoutMode => "BLACKOUT MODE".into(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scoring::TransportClass;

    fn req(attempt: u32, blackout: bool, last: FailClass) -> ConnectRequest {
        let mut fra = EndpointHealth::new("fra-04", false);
        fra.push_latency(35.0);
        let mut cdn = EndpointHealth::new("cdn-ams", true);
        cdn.push_latency(90.0);
        ConnectRequest {
            endpoints: vec![
                EndpointCandidate { id: fra.endpoint_id.clone(), health: fra, transport: TransportClass::RealityDirect },
                EndpointCandidate { id: "cdn-ams".into(), health: cdn, transport: TransportClass::WsTlsCdn },
            ],
            dpi_features: DpiFeatures {
                rtt_variance: 0.1,
                rst_rate: 0.1,
                handshake_fail_ratio: 0.1,
                reset_after_client_hello: 0.1,
                payload_entropy: 0.9,
                timing_regularity: 0.1,
                throttle_ratio: 0.1,
                probe_hit_rate: 0.0,
            },
            last_failure: last,
            attempt,
            intl_blackout: blackout,
        }
    }

    #[test]
    fn picks_best_endpoint_and_is_explainable() {
        let r = connect(&req(0, false, FailClass::None));
        assert!(r.plan.may_proceed);
        assert_eq!(r.plan.selected_endpoint, "fra-04");
        assert!(!r.plan.events.is_empty());
    }

    #[test]
    fn blackout_uses_cdn_only() {
        let r = connect(&req(0, true, FailClass::None));
        assert_eq!(r.plan.selected_endpoint, "cdn-ams");
        assert_eq!(r.plan.transport, TransportClass::WsTlsCdn);
        assert!(r
            .plan
            .countermeasures
            .actions
            .iter()
            .any(|a| matches!(a, Countermeasure::BlackoutMode)));
    }

    #[test]
    fn retry_budget_is_bounded() {
        let r = connect(&req(MAX_ATTEMPTS, false, FailClass::HandshakeTimeout));
        assert!(!r.plan.may_proceed);
        assert_eq!(r.plan.selected_endpoint, "none");
    }

    #[test]
    fn backoff_grows_exponentially_but_bounded() {
        let a = connect(&req(0, false, FailClass::None)).plan.backoff_ms;
        let b = connect(&req(2, false, FailClass::None)).plan.backoff_ms;
        let c = connect(&req(9, false, FailClass::None));
        assert_eq!(a, 500);
        assert_eq!(b, 2000);
        assert!(c.plan.backoff_ms <= MAX_BACKOFF_MS);
    }
}
