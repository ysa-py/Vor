# SECURITY.md & THREAT-MODEL

## Security limitations (honest, per spec §54)

We do **not** claim: unbreakable, 100% anti-bypass, impossible to crack or
reverse engineer. Client-side software cannot honestly guarantee unpatchability.
Our goal: cryptographic authenticity, layered authorization, tamper evidence,
secure key management, release hardening, minimized attack surface, detection,
fail-closed authorization.

## Layers (defense in depth)

1. **Cryptographic license signature** — Ed25519 over canonical JSON; any field
   modification invalidates.
2. **Trusted key set** — only operator-controlled `key_id`s verify.
3. **Secure storage** — Android Keystore / DPAPI; HMAC-sealed activation cache.
4. **Fail-closed gate** — no UI path reaches the client without a verified
   license (enforced at the shell level).
5. **Release hardening** — LTO + strip + panic=abort (Rust), R8 + resource
   shrinking (Android), signed installers; source remains readable.
6. **Tamper-evident audit** — hash-chained ledger; retro-edit detected.
7. **Secret hygiene** — gitleaks in CI; private keys never in repo/CI logs;
   diagnostics exports sanitized (URIs/hashes redacted).

## Threat model

| Threat | Mitigation | Detection | Residual risk |
|---|---|---|---|
| Forged license | Ed25519 unforgeability | E_SIGNATURE at gate | quantum (out of scope) |
| Modified license payload | signature over canonical bytes | E_SIGNATURE | — |
| Patched verifier / modified APK | R8 + signed releases + integrity fail-closed gate | release diffing | determined local patching (documented, not hidden) |
| Stolen license | HWID binding | E_DEVICE on other machines | HWID spoofing on rooted hosts |
| Signing-key compromise | hard rotation retires old keys | audit ledger ROTATE entries | window between compromise & rotation |
| Clock manipulation | ±300 s bounded skew only | E_EXPIRED persists | long-term offline freeze (bounded by design) |
| Config tampering | HMAC cache seal; UCI/render pipeline | CacheCorrupted → re-verify | — |
| Debugger / rooted device | obfuscation raises cost, not absolute | runtime checks | fully-compromised host = game over (any software) |
| DPI/replay of tunnel | Reality/uTLS + rotating fingerprints + mux + port hop | engine classifier | arms race — model retrainable via `tools/train_dpi_model.py` |
| Fake "AI" claims | real MLP with published weights + accuracy; deterministic scoring documented | UI shows model version | — |

## Anti-censorship honesty

Countermeasures (ClientHello split, MSS clamp, uTLS rotation, fronted SNI,
CDN routing, blackout mode) raise the cost of censorship substantially but no
evasion is permanent against an adaptive adversary. The engine is built for
rapid adaptation: features → classifier → countermeasure plan are all
data-driven and retrainable offline.

<div dir="rtl">
<b>فارسی:</b> امنیت لایه‌لایه است؛ ادعای «شکست‌ناپذیر» نداریم. هدف: اصالت
رمزنگارانه، اثبات دستکاری، کلید ایمن، fail-closed و شفافیت کامل محدودیت‌ها.
</div>
