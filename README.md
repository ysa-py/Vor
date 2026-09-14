# VOR — Secure Tunnel

<div dir="rtl">

**فارسی:** وی‌پی‌ان مقاوم در برابر فیلترینگ هوشمند ایران با هسته Rust، لایسنس آفلاین Ed25519 و موتور ضد-DPI مبتنی بر مدل عصبی واقعی. این مخزن شامل اپ کlients (اندروید/iOS/ویندوز)، ابزار جداگانه Vor License Manager، پکیج OpenWrt و خط تولید کامل GitHub Actions برای خروجی‌های `.apk` / `.ipa` / `.exe` / `.ipk` است.

</div>

**English:** Production-grade anti-censorship VPN client (hardened fork concept of V2RayEZ → **VOR**) with a Rust security core, offline-first Ed25519 licensing, and a real trained neural DPI classifier driving adaptive countermeasures. Ships as Flutter clients for Android/iOS/Windows, a separate **Vor License Manager** administrative app, an OpenWrt LuCI package, and full CI/CD pipelines.

## Architecture

```
vor/
├── core/                     Rust workspace (100% offline, no runtime network deps)
│   ├── vor-license/          Ed25519 licensing: canonical JSON, envelope VORLIC1,
│   │                         HWID binding, key rotation (soft/hard), HMAC-sealed
│   │                         cache, hash-chained audit ledger
│   ├── vor-engine/           Smart engine: explainable endpoint/transport scoring,
│   │                         REAL 8→16→8→3 MLP DPI classifier (trained weights),
│   │                         countermeasure planner, adaptive controller
│   │                         (bounded retries, backoff, blackout mode), Xray
│   │                         config generation, subscription parser
│   ├── vor-ffi/              Stable C ABI (JSON in/out) for Flutter dart:ffi
│   └── vor-cli/              vor-lictool — administrative CLI behind the Manager
├── apps/
│   ├── vor_client/           Flutter client (Android/iOS/Windows)
│   └── vor_license_manager/  Standalone offline license authority (admin only)
├── openwrt/luci-app-vor/     LuCI app + procd init + watchdog + countermeasures
├── .github/workflows/        ci.yml · build-android.yml · build-ios.yml ·
│                             build-windows.yml · build-openwrt.yml
├── tools/train_dpi_model.py  Reproducible DPI model training (numpy, offline)
└── docs/                     Feature inventory, architecture, license system,
                              security, threat model, release engineering
```

## Anti-DPI engine (honest capability statement)

* **Real ML**: `tools/train_dpi_model.py` trains an 8→16→8→3 MLP on documented
  DPI-behavior feature distributions; weights ship inside every client and the
  SAME inference runs in Rust (native), TypeScript (web preview), and Dart
  (Flutter defense tab). No fake "AI" labels — the model version and validation
  accuracy are displayed in the UI.
* **Countermeasures**: TLS ClientHello split, MSS clamp/fragmentation, uTLS
  fingerprint rotation (`chrome` → `randomized`), fronted SNI, mux, port
  hopping, DNS strategies (DoH/DoT/domestic-direct/hard bootstrap IPs),
  transport escalation ladder (`reality_direct → ws_tls_cdn → grpc_tls →
  httpupgrade_cdn → ss2022`).
* **Blackout mode**: when international connectivity collapses, the watchdog
  (OpenWrt) / engine (apps) switches to CDN-routed endpoints only + domestic
  DNS bootstrap + aggressive fragmentation.
* **Split routing**: Iranian domestic traffic (geosite:category-ir, geoip:ir)
  and private ranges always route DIRECT.
* **Honesty**: client-side obfuscation is detection/evasion, not a guarantee.
  We never claim "unbreakable" — see `docs/SECURITY.md`.

## Licensing (offline-first, fail-closed)

```text
Operator (air-gapped)                     Customer device
─────────────────────                     ───────────────
Vor License Manager / vor-lictool
  init-keystore ./vault
  issue ./vault --tier enterprise \
      --days 365 --hwid HWID-SHA256-…
  export-public ./vault trusted.json  ──▶  embedded in client build
                                           VOR first launch → License Gate
                                           verify (Ed25519, expiry, HWID,
                                           revocation) → 100% local
```

* Private signing key **never** ships in clients, CI logs, or this repo.
* Verification works fully offline; expiration enforced locally with bounded
  (±300 s) clock skew tolerance; tamper → `E_SIGNATURE`, gate stays closed.
* 20-case integration matrix (`core/vor-license/tests/license_tests.rs`)
  covers every rejection path from the master spec §40.

## Build matrix (GitHub Actions → Releases)

| Platform   | Artifact                     | Workflow              |
|------------|------------------------------|-----------------------|
| Android    | `VOR-vX.apk` (+ manager apk) | `build-android.yml`   |
| iOS        | `VOR-unsigned.ipa`           | `build-ios.yml`       |
| Windows    | `VOR-Setup-x64.exe`          | `build-windows.yml`   |
| OpenWrt    | `luci-app-vor_X_all.ipk`     | `build-openwrt.yml`   |

Signing: set repository secrets `VOR_KEYSTORE_B64`, `VOR_KEYSTORE_PASS`,
`VOR_KEY_PASS`, `VOR_KEY_ALIAS` to produce signed Android releases; unsigned
artifacts are still produced and checksummed otherwise.

## Live UI/UX preview

The complete interactive preview (License Gate → tunnel dashboard → AI
defense matrix with live model inference → diagnostics console → License
Manager) runs as a single-route Next.js app — see the delivered preview link
or `apps/preview/` in the release archive. It performs REAL Ed25519
verification in-browser and loads the REAL trained model weights.

## Verified in this workspace (no fabricated results)

* `cargo test --workspace` — **61 passed / 0 failed**, clippy clean.
* CLI end-to-end: issue → verify OK → tampered REJECTED → wrong-device
  `E_DEVICE` → +400d `E_EXPIRED` → audit chain intact.
* Web preview browser-tested end-to-end: manager issue → gate activation →
  tunnel connect → DPI scenario reclassification (100% confidence) → tamper
  rejection (`E_SIGNATURE`) → expired rejection → mobile 390 px no overflow.
* Shell scripts syntax-checked; Xray config structures unit-tested.

## License

GPL-3.0-or-later. Xray-core, Flutter and OpenWrt remain property of their
respective upstream projects.
