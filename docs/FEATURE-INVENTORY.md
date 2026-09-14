# FEATURE-INVENTORY

Complete inventory of the VOR product as implemented in this repository.
Status legend: ✅ implemented & tested · 🔨 implemented (validated by CI on real
platform builders) · 📋 documented protocol-level support.

## Identity
| Feature | Location | Status |
|---|---|---|
| Product name VOR (V2RayEZ branding removed) | repo-wide; `ci.yml` branding-audit job | ✅ |
| Protocol names preserved (VLESS/VMess/Xray/Reality/SS2022) | `core/vor-engine/src/xray.rs` | ✅ |
| VOR shield emblem icon across apps/preview | `assets/vor_shield_emblem.png` | ✅ |

## Licensing (offline-first, Ed25519)
| Feature | Location | Status |
|---|---|---|
| License Gate = first screen, fail-closed | `apps/vor_client/lib/ui/gate/`, web `LicenseGate.tsx`, `VorShell.tsx` enforcement | ✅ |
| Canonical JSON + `VORLIC1` envelope | `core/vor-license/src/{canonical,issue}.rs`, `src/lib/vor/license.ts` | ✅ |
| Ed25519 signing/verification | `keys.rs`, `verify.rs` (Rust), `@noble/ed25519` (web), `cryptography` (manager) | ✅ |
| HWID binding + normalization | `hwid.rs`, `hwid.ts` | ✅ |
| Expiry enforcement + ±300 s skew | `verify.rs` | ✅ |
| Local revocation list | `verify.rs`, manager revoke | ✅ |
| Key rotation (soft/hard) + key-id trust set | `keys.rs` | ✅ |
| HMAC-sealed activation cache | `storage.rs` | ✅ |
| Hash-chained audit ledger (tamper-evident) | `audit.rs` | ✅ |
| 20-case rejection matrix tests | `tests/license_tests.rs` | ✅ 61/61 |
| CLI authority tool (`vor-lictool`) | `core/vor-cli` | ✅ |
| Separate Manager app (issue/verify/revoke/rotate/QR/export) | `apps/vor_license_manager`, web `ManagerView` | ✅ |

## Smart engine & anti-DPI
| Feature | Location | Status |
|---|---|---|
| Explainable endpoint scoring (latency/jitter/loss/stability) | `scoring.rs`, `tunnel.ts` | ✅ |
| Transport fallback ladder + bounded retries (5, backoff 500ms·2ⁿ ≤8s) | `controller.rs`, `store.ts`, `vpn_engine.dart` | ✅ |
| REAL MLP DPI classifier (8→16→8→3, trained) | `dpi/{features,model}.rs`, `tools/train_dpi_model.py` | ✅ |
| Countermeasure planner (split@N, MSS clamp, uTLS rotation, fronted SNI, mux, port hop, DNS modes, transport switch) | `dpi/countermeasures.rs` | ✅ |
| Blackout mode (CDN-only + bootstrap DNS + aggressive split) | `controller.rs`, watchdog | ✅ |
| Xray config generation (Reality / WS+TLS+CDN / VMess / Trojan / SS2022) + IR split routing | `xray.rs` + unit tests | ✅ |
| Subscription parser (vless/vmess/trojan/ss, base64 lists, fuzzish inputs never panic) | `subscription.rs` + tests | ✅ |
| Connection state machine (Idle→…→Connected, diagnosing, license states) | engine + UI stores | ✅ |
| Network change / reconnect recovery | `connectivity_plus` wiring, watchdog | 🔨 |

## Client UX (13 stitch screens)
| Feature | Location | Status |
|---|---|---|
| Cryptographic License Gate (HWID card, paste/file/QR) | `vor_cryptographic_license_gate` → Gate screens | ✅ |
| Tunnel dashboard (concentric dial, telemetry strip, cipher profile) | `vor_vpn_main_tunnel_dashboard` → Dashboard | ✅ |
| Advanced analytics (latency/jitter/loss charts, endpoint health) | `vor_advanced_network_telemetry` → Analytics | ✅ |
| AI defense matrix + sentry panel | `vor_autonomous_ai_defense_matrix…`, `vor_ai_neural_network…` → Defense | ✅ |
| Kernel config + FIPS crypto panels | `vor_config_…`, `vor_fips_140_3…` → Settings | ✅ |
| Diagnostics deep threat inspector + forensic console | `vor_diagnostics_deep_threat_inspector` | ✅ |
| License Manager console / issue modal / bind-HWID modal / HWID audit | `vor_license_manager_*` → Manager views | ✅ |
| FA/EN with RTL mirroring | i18n dictionaries | ✅ |

## Platform transport
| Feature | Location | Status |
|---|---|---|
| Android VpnService tunnel (xray core via flutter_v2ray) | `transport_runner.dart` | 🔨 |
| Windows xray.exe child-process runner + SOCKS probe | `transport_runner.dart` | 🔨 |
| iOS NetworkExtension entitlements (unsigned IPA) | `build-ios.yml` | 🔨 |
| OpenWrt procd service + UCI render + IR split routing | `openwrt/.../init.d/vor` | 🔨 |
| nftables/iptables MSS clamp + split hooks + port hop | `vor-countermeasure` | 🔨 |
| Blackout watchdog with ladder walk + auto restore | `vor-watchdog` | 🔨 |

## Release engineering
| Feature | Location | Status |
|---|---|---|
| Android APK (3 ABIs, R8, sha256 manifest) | `build-android.yml` | 🔨 |
| iOS unsigned IPA | `build-ios.yml` | 🔨 |
| Windows Inno Setup EXE + xray bundle | `build-windows.yml` | 🔨 |
| OpenWrt .ipk (SDK matrix) | `build-openwrt.yml` | 🔨 |
| Secret scanning (gitleaks) + branding audit | `ci.yml` | 🔨 |
| Deterministic platform scaffolds (`flutter create` + idempotent patches) | `tool/bootstrap_platforms.sh` | 🔨 |
