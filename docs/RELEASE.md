# RELEASE.md — releasing VOR (apk / ipa / exe / ipk)

## One-time setup

1. Create the GitHub repository (e.g. `github.com/ysa-py/vor`) and push:

```bash
cd vor
git init && git add -A && git commit -m "VOR 1.0.0 — production release"
git branch -M main
git remote add origin https://github.com/ysa-py/vor.git
git push -u origin main
```

> The sandbox that produced this repository had no GitHub credentials
> (tokens are not available to the build environment), so the push must be
> performed by the repository owner. Everything is committed and ready.

2. (Optional, for signed Android releases) Add repository secrets:
   `VOR_KEYSTORE_B64` (base64 of the .jks), `VOR_KEYSTORE_PASS`, `VOR_KEY_PASS`,
   `VOR_KEY_ALIAS`.

## Cutting a release

```bash
git tag v1.0.0 && git push origin v1.0.0
```

GitHub Actions then builds and attaches to the Release page:

| Workflow | Artifacts |
|---|---|
| `build-android.yml` | `VOR-vX-release.apk` per ABI + SHA256SUMS, `VorLicenseManager-vX.apk` |
| `build-ios.yml` | `VOR-unsigned.ipa` + SHA256SUMS (sideload/TestFlight ready) |
| `build-windows.yml` | `VOR-Setup-x64.exe`, `VorLicenseManager-Setup-x64.exe` (+ bundled xray core) |
| `build-openwrt.yml` | `luci-app-vor_1.0.0-1_all.ipk` for x86_64 & aarch64 |

`ci.yml` gates every push: cargo fmt/clippy/test, CLI license end-to-end,
gitleaks, branding audit, flutter analyze.

## Operator workflow (offline licensing)

```bash
# on the air-gapped machine
vor-lictool init-keystore ./vault
vor-lictool issue ./vault --tier enterprise --days 365 \
    --hwid HWID-SHA256-<customer> --out customer.vorlic
vor-lictool export-public ./vault ./trusted.json
# → re-embed trusted.json in the next client build (assets/keys/) OR
#   distribute .vorlic files directly; clients verify 100% offline.
```

## Platform scaffolds

`apps/*/tool/bootstrap_platforms.sh` materializes `android/`, `ios/`,
`windows/` via `flutter create` then applies idempotent VOR patches (minSdk 24,
R8/proguard, VPN permissions, NetworkExtension entitlements). This keeps the
repo at current Flutter project formats and all patches reviewable.

## Deterministic-ish Rust release profile

`[profile.release] lto=true, codegen-units=1, strip="symbols",
panic="abort", opt-level="z"` — small hardened binaries; no claims of
reproducible byte-identical builds.

## Hardening checklist before tagging

- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] `cargo test --workspace` green
- [ ] gitleaks clean
- [ ] branding audit green (no V2RayEZ outside docs)
- [ ] trusted-keys bundle refreshed if keys rotated
- [ ] revoked.json regenerated if revocations occurred
- [ ] flutter analyze green for both apps
