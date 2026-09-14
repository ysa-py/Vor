use serde::{Deserialize, Serialize};

use super::features::DpiFeatures;
use super::weights::{B1, B2, B3, W1, W2, W3, MODEL_VERSION, TRAIN_ACCURACY};

/// Classifier output classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DpiClass {
    Benign,
    Throttling,
    ActiveDpi,
}

impl DpiClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            DpiClass::Benign => "benign",
            DpiClass::Throttling => "throttling",
            DpiClass::ActiveDpi => "active_dpi",
        }
    }
    pub fn from_index(i: usize) -> Self {
        match i {
            0 => DpiClass::Benign,
            1 => DpiClass::Throttling,
            _ => DpiClass::ActiveDpi,
        }
    }
}

/// Full inference verdict with class probabilities (explainable).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DpiVerdict {
    pub class: DpiClass,
    pub confidence: f32,
    pub probs: [f32; 3],
    pub model_version: String,
    pub train_accuracy: f32,
}

/// Forward pass: 8 → 16 ReLU → 8 ReLU → 3 Softmax.
/// Genuine inference — same math as training (numpy) and the TS preview.
pub fn classify(features: &DpiFeatures) -> DpiVerdict {
    let x = features.sanitized().as_array();

    let mut h1 = [0f32; 16];
    for (i, row) in W1.iter().enumerate() {
        let mut acc = B1[i];
        for j in 0..8 {
            acc += row[j] * x[j];
        }
        h1[i] = if acc > 0.0 { acc } else { 0.0 };
    }

    let mut h2 = [0f32; 8];
    for (i, row) in W2.iter().enumerate() {
        let mut acc = B2[i];
        for j in 0..16 {
            acc += row[j] * h1[j];
        }
        h2[i] = if acc > 0.0 { acc } else { 0.0 };
    }

    let mut logits = [0f32; 3];
    for (i, row) in W3.iter().enumerate() {
        let mut acc = B3[i];
        for j in 0..8 {
            acc += row[j] * h2[j];
        }
        logits[i] = acc;
    }

    // Numerically stable softmax.
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|l| (l - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    let mut probs = [0f32; 3];
    for i in 0..3 {
        probs[i] = exps[i] / sum;
    }

    let mut best = 0usize;
    for i in 1..3 {
        if probs[i] > probs[best] {
            best = i;
        }
    }

    DpiVerdict {
        class: DpiClass::from_index(best),
        confidence: probs[best],
        probs,
        model_version: MODEL_VERSION.into(),
        train_accuracy: TRAIN_ACCURACY,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(vals: [f32; 8]) -> DpiFeatures {
        DpiFeatures {
            rtt_variance: vals[0],
            rst_rate: vals[1],
            handshake_fail_ratio: vals[2],
            reset_after_client_hello: vals[3],
            payload_entropy: vals[4],
            timing_regularity: vals[5],
            throttle_ratio: vals[6],
            probe_hit_rate: vals[7],
        }
    }

    #[test]
    fn probs_are_normalized() {
        let v = classify(&f([0.5; 8]));
        let s: f32 = v.probs.iter().sum();
        assert!((s - 1.0).abs() < 1e-4);
        assert_eq!(v.model_version.len() > 3, true);
    }

    #[test]
    fn is_deterministic() {
        let x = f([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        let a = classify(&x);
        let b = classify(&x);
        assert_eq!(a.probs, b.probs);
    }

    #[test]
    fn trained_model_separates_the_three_classes() {
        // Goldens mirror the training distribution means (tools/train_dpi_model.py).
        let benign = f([0.15, 0.05, 0.08, 0.05, 0.88, 0.12, 0.08, 0.03]);
        let throttling = f([0.45, 0.20, 0.25, 0.15, 0.55, 0.75, 0.70, 0.10]);
        let active = f([0.70, 0.65, 0.60, 0.70, 0.25, 0.45, 0.30, 0.65]);

        let v = classify(&benign);
        assert_eq!(v.class, DpiClass::Benign, "benign misclassified: {v:?}");
        assert!(v.confidence > 0.9, "low confidence on benign: {v:?}");

        let v = classify(&throttling);
        assert_eq!(v.class, DpiClass::Throttling, "throttling misclassified: {v:?}");
        assert!(v.confidence > 0.9);

        let v = classify(&active);
        assert_eq!(v.class, DpiClass::ActiveDpi, "active_dpi misclassified: {v:?}");
        assert!(v.confidence > 0.9);

        // Trained weights must actually be loaded (not the zero placeholder).
        assert!(classify(&benign).model_version != "untrained");
    }
}
