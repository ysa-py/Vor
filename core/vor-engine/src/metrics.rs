use serde::{Deserialize, Serialize};

/// Rolling performance metrics for one endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointHealth {
    pub endpoint_id: String,
    /// Latency samples (ms), most recent last.
    pub latency_samples: Vec<f32>,
    /// Packet loss percentage 0..=100 (recent window).
    pub loss_pct: f32,
    /// Consecutive failures (handshake errors, resets, timeouts).
    pub fail_streak: u32,
    /// Consecutive successes.
    pub success_streak: u32,
    /// Unix seconds of last failure.
    pub last_fail_at: Option<i64>,
    /// True when this endpoint routes through a CDN (blackout-resilient class).
    pub cdn_routed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetricsWindow {
    pub rtt_min_ms: f32,
    pub rtt_max_ms: f32,
    pub jitter_ms: f32,
    pub loss_pct: f32,
    pub duration_secs: u64,
    pub reconnects: u32,
}

impl EndpointHealth {
    pub fn new(endpoint_id: &str, cdn_routed: bool) -> Self {
        EndpointHealth {
            endpoint_id: endpoint_id.into(),
            latency_samples: Vec::new(),
            loss_pct: 0.0,
            fail_streak: 0,
            success_streak: 0,
            last_fail_at: None,
            cdn_routed,
        }
    }

    pub fn push_latency(&mut self, ms: f32) {
        self.latency_samples.push(ms);
        if self.latency_samples.len() > 20 {
            self.latency_samples.remove(0);
        }
    }

    pub fn mean_latency(&self) -> f32 {
        if self.latency_samples.is_empty() {
            return f32::MAX / 4.0; // heavily penalize "never measured"
        }
        self.latency_samples.iter().sum::<f32>() / self.latency_samples.len() as f32
    }

    /// Jitter = mean absolute successive difference (MAD-style).
    pub fn jitter(&self) -> f32 {
        if self.latency_samples.len() < 2 {
            return 0.0;
        }
        let n = self.latency_samples.len() - 1;
        self.latency_samples
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .sum::<f32>()
            / n as f32
    }

    pub fn record_success(&mut self) {
        self.fail_streak = 0;
        self.success_streak = self.success_streak.saturating_add(1);
    }

    pub fn record_failure(&mut self, at: i64) {
        self.success_streak = 0;
        self.fail_streak = self.fail_streak.saturating_add(1);
        self.last_fail_at = Some(at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_math_is_correct() {
        let mut h = EndpointHealth::new("e1", false);
        for v in [20.0, 24.0, 22.0, 26.0] {
            h.push_latency(v);
        }
        // |4|+|2|+|4| = 10 / 3 ≈ 3.333
        assert!((h.jitter() - 3.3333).abs() < 0.001);
        assert!((h.mean_latency() - 23.0).abs() < 0.001);
    }

    #[test]
    fn unmeasured_endpoint_penalized_not_nan() {
        let h = EndpointHealth::new("e2", false);
        assert!(h.mean_latency() > 1000.0);
        assert_eq!(h.jitter(), 0.0);
    }
}
