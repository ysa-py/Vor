//! VOR Smart Engine.
//!
//! Honesty note (master spec §47): the DPI classifier below is a REAL neural
//! network (8→16→8→3 MLP) with weights trained offline by
//! `tools/train_dpi_model.py` — it performs genuine inference on live
//! connection features. Endpoint/transport selection is deterministic
//! explainable scoring ("Smart Routing") — we never fake capabilities.

pub mod controller;
pub mod dpi;
pub mod metrics;
pub mod scoring;
pub mod subscription;
pub mod xray;

pub use controller::{connect, ConnectionPlan, ConnectRequest, ConnectResult, EngineEvent, FailClass};
pub use dpi::countermeasures::{Countermeasure, CountermeasurePlan};
pub use dpi::features::DpiFeatures;
pub use dpi::model::{classify, DpiClass, DpiVerdict};
pub use metrics::{EndpointHealth, MetricsWindow};
pub use scoring::{score_endpoint, DecisionExplanation, TransportClass};
