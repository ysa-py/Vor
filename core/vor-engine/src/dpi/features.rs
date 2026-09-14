use serde::{Deserialize, Serialize};

/// Live traffic features feeding the DPI classifier.
///
/// All values are normalized to 0..=1 during extraction from raw telemetry
/// (RTT variance, TCP RST counts, handshake outcomes, payload entropy...).
/// Feature extraction mirrors `tools/train_dpi_model.py` EXACTLY — the model
/// is only as honest as this parity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DpiFeatures {
    /// Normalized RTT variance (0 stable .. 1 erratic).
    pub rtt_variance: f32,
    /// TCP RST rate observed on tunnel sockets (0..1).
    pub rst_rate: f32,
    /// Handshake failure ratio over recent attempts (0..1).
    pub handshake_fail_ratio: f32,
    /// Connection reset immediately after ClientHello (0..1 of attempts).
    pub reset_after_client_hello: f32,
    /// Shannon entropy of first payloads (normalized 0..1; DPI RST-injection
    /// and blocking pages reduce it).
    pub payload_entropy: f32,
    /// Timing regularity of blocks (1 = suspiciously periodic throttling).
    pub timing_regularity: f32,
    /// Throughput throttling ratio observed (0 none .. 1 fully choked).
    pub throttle_ratio: f32,
    /// Active-probing hit rate (bogus requests to the endpoint being answered).
    pub probe_hit_rate: f32,
}

pub const FEATURE_ORDER: [&str; 8] = [
    "rtt_variance",
    "rst_rate",
    "handshake_fail_ratio",
    "reset_after_client_hello",
    "payload_entropy",
    "timing_regularity",
    "throttle_ratio",
    "probe_hit_rate",
];

impl DpiFeatures {
    pub fn as_array(&self) -> [f32; 8] {
        [
            self.rtt_variance,
            self.rst_rate,
            self.handshake_fail_ratio,
            self.reset_after_client_hello,
            self.payload_entropy,
            self.timing_regularity,
            self.throttle_ratio,
            self.probe_hit_rate,
        ]
    }

    /// Clamp defensively — malformed telemetry must never poison inference.
    pub fn sanitized(&self) -> Self {
        let cl = |v: f32| v.clamp(0.0, 1.0);
        DpiFeatures {
            rtt_variance: cl(self.rtt_variance),
            rst_rate: cl(self.rst_rate),
            handshake_fail_ratio: cl(self.handshake_fail_ratio),
            reset_after_client_hello: cl(self.reset_after_client_hello),
            payload_entropy: cl(self.payload_entropy),
            timing_regularity: cl(self.timing_regularity),
            throttle_ratio: cl(self.throttle_ratio),
            probe_hit_rate: cl(self.probe_hit_rate),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_clamps_all() {
        let f = DpiFeatures {
            rtt_variance: 1.7,
            rst_rate: -0.2,
            handshake_fail_ratio: 0.5,
            reset_after_client_hello: 0.5,
            payload_entropy: 0.9,
            timing_regularity: 3.0,
            throttle_ratio: 0.1,
            probe_hit_rate: 0.0,
        };
        let s = f.sanitized();
        assert_eq!(s.rtt_variance, 1.0);
        assert_eq!(s.rst_rate, 0.0);
        assert_eq!(s.timing_regularity, 1.0);
    }
}
