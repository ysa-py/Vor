#!/usr/bin/env python3
"""
VOR DPI Classifier — REAL model training.

Trains an 8→16→8→3 MLP on synthetic-but-realistic DPI behavior signatures
(benign / throttling / active_dpi), then emits:
  1. core/vor-engine/src/dpi/weights.rs   (Rust inference)
  2. apps/vor_client/assets/model/model_manifest.json
  3. web-preview weights are embedded by the preview from the same JSON

Synthetic data model (documented for honesty & reproducibility):
  * benign:      low RST/reset/probe rates, high payload entropy, low regularity
  * throttling:  high timing regularity + throttle ratio, moderate entropy loss
  * active_dpi:  high RST rate, resets right after ClientHello, probe hits,
                 entropy collapse, handshake failures
Feature distributions are Gaussian mixtures per class with noise; gradients
are plain autograd-free numpy backprop (small net, no frameworks → offline).
"""

import json
import numpy as np

rng = np.random.default_rng(42)

FEATURES = [
    "rtt_variance", "rst_rate", "handshake_fail_ratio", "reset_after_client_hello",
    "payload_entropy", "timing_regularity", "throttle_ratio", "probe_hit_rate",
]

# class → (mean vector over FEATURES, std vector)
CLASS_PARAMS = {
    0: (  # benign
        [0.15, 0.05, 0.08, 0.05, 0.88, 0.12, 0.08, 0.03],
        [0.10, 0.04, 0.05, 0.04, 0.06, 0.07, 0.05, 0.03],
    ),
    1: (  # throttling
        [0.45, 0.20, 0.25, 0.15, 0.55, 0.75, 0.70, 0.10],
        [0.14, 0.10, 0.12, 0.09, 0.12, 0.13, 0.14, 0.07],
    ),
    2: (  # active_dpi
        [0.70, 0.65, 0.60, 0.70, 0.25, 0.45, 0.30, 0.65],
        [0.14, 0.15, 0.15, 0.14, 0.13, 0.15, 0.13, 0.16],
    ),
}

N_PER_CLASS = 6000
EPOCHS = 160
LR = 0.05
BATCH = 128


def gen_split():
    X, y = [], []
    for cls, (mu, sd) in CLASS_PARAMS.items():
        data = rng.normal(mu, sd, size=(N_PER_CLASS, len(FEATURES)))
        data = np.clip(data, 0.0, 1.0)
        X.append(data)
        y.append(np.full(N_PER_CLASS, cls))
    X = np.vstack(X).astype(np.float32)
    y = np.concatenate(y)
    idx = rng.permutation(len(X))
    return X[idx], y[idx]


def init_params():
    W1 = rng.normal(0, np.sqrt(2 / 8), size=(16, 8)).astype(np.float32)
    b1 = np.zeros(16, dtype=np.float32)
    W2 = rng.normal(0, np.sqrt(2 / 16), size=(8, 16)).astype(np.float32)
    b2 = np.zeros(8, dtype=np.float32)
    W3 = rng.normal(0, np.sqrt(2 / 8), size=(3, 8)).astype(np.float32)
    b3 = np.zeros(3, dtype=np.float32)
    return W1, b1, W2, b2, W3, b3


def forward(params, X):
    W1, b1, W2, b2, W3, b3 = params
    z1 = X @ W1.T + b1
    a1 = np.maximum(z1, 0)
    z2 = a1 @ W2.T + b2
    a2 = np.maximum(z2, 0)
    z3 = a2 @ W3.T + b3
    e = np.exp(z3 - z3.max(axis=1, keepdims=True))
    p = e / e.sum(axis=1, keepdims=True)
    return (z1, a1, z2, a2, p)


def accuracy(params, X, y):
    *_, p = forward(params, X)
    return float((p.argmax(axis=1) == y).mean())


def train():
    X, y = gen_split()
    n_val = 3000
    Xv, yv, Xt, yt = X[:n_val], y[:n_val], X[n_val:], y[n_val:]
    params = init_params()
    for epoch in range(EPOCHS):
        order = rng.permutation(len(Xt))
        for i in range(0, len(Xt), BATCH):
            idx = order[i : i + BATCH]
            xb, yb = Xt[idx], yt[idx]
            z1, a1, z2, a2, p = forward(params, xb)
            onehot = np.eye(3, dtype=np.float32)[yb]
            dz3 = (p - onehot) / len(xb)
            dW3 = dz3.T @ a2
            db3 = dz3.sum(axis=0)
            da2 = dz3 @ params[4]
            dz2 = da2 * (z2 > 0)
            dW2 = dz2.T @ a1
            db2 = dz2.sum(axis=0)
            da1 = dz2 @ params[2]
            dz1 = da1 * (z1 > 0)
            dW1 = dz1.T @ xb
            db1 = dz1.sum(axis=0)
            grads = (dW1, db1, dW2, db2, dW3, db3)
            params = tuple(w - LR * g for w, g in zip(params, grads))
        if epoch % 20 == 0 or epoch == EPOCHS - 1:
            print(f"epoch {epoch:3d}  train_acc={accuracy(params, Xt, yt):.4f}  val_acc={accuracy(params, Xv, yv):.4f}")
    return params, accuracy(params, Xv, yv)


def rust_weights(params, val_acc):
    W1, b1, W2, b2, W3, b3 = params
    def fmt_row(v):
        return ", ".join(f"{x:.6f}" for x in v)
    def matrix(name, rows, cols):
        lines = ",\n".join(f"    [{fmt_row(r)}]" for r in rows)
        return f"pub const {name}: [[f32; {cols}]; {len(rows)}] = [\n{lines},\n];\n"
    def arr(name, v):
        return f"pub const {name}: [f32; {len(v)}] = [{fmt_row(v)}];\n"
    return f"""//! Trained MLP weights for the DPI classifier.
//!
//! ⚠ GENERATED FILE — produced by `tools/train_dpi_model.py`. Do not edit by
//! hand; retrain instead (`python3 tools/train_dpi_model.py`).
//! Architecture: 8 → 16 (ReLU) → 8 (ReLU) → 3 (Softmax)
//! Classes: 0=benign, 1=throttling, 2=active_dpi

{matrix("W1", W1, 8)}
{arr("B1", b1)}
{matrix("W2", W2, 16)}
{arr("B2", b2)}
{matrix("W3", W3, 8)}
{arr("B3", b3)}

pub const MODEL_VERSION: &str = "vor-dpi-mlp-1.0.0";
pub const TRAIN_ACCURACY: f32 = {val_acc:.4};
"""


def manifest(params, val_acc):
    W1, b1, W2, b2, W3, b3 = params
    return {
        "model": "vor-dpi-mlp",
        "version": "vor-dpi-mlp-1.0.0",
        "architecture": [8, 16, 8, 3],
        "activations": ["relu", "relu", "softmax"],
        "classes": ["benign", "throttling", "active_dpi"],
        "features": FEATURES,
        "val_accuracy": round(float(val_acc), 4),
        "weights": {
            "W1": W1.tolist(), "b1": b1.tolist(),
            "W2": W2.tolist(), "b2": b2.tolist(),
            "W3": W3.tolist(), "b3": b3.tolist(),
        },
    }


if __name__ == "__main__":
    params, val_acc = train()
    print(f"\nFINAL val_accuracy = {val_acc:.4f}")
    rust = rust_weights(params, val_acc)
    with open("core/vor-engine/src/dpi/weights.rs", "w") as f:
        f.write(rust)
    with open("apps/vor_client/assets/model/model_manifest.json", "w") as f:
        json.dump(manifest(params, val_acc), f, indent=2)
    # quick sanity: known vectors
    X, y = gen_split()
    Xv, yv = X[:2000], y[:2000]
    *_, p = forward(params, Xv)
    print("per-class val accuracy:",
          {c: round(float(((p.argmax(1) == yv) & (yv == c)).sum() / (yv == c).sum()), 4) for c in (0, 1, 2)})
    print("weights.rs + model_manifest.json written.")
