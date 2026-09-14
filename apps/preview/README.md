# VOR Live Preview (Next.js 16)

Single-route interactive preview of the whole product: License Gate → tunnel
dashboard → analytics → AI defense (REAL Ed25519 + REAL trained MLP inference,
100% in-browser, zero network).

## Run
```bash
bun add @noble/ed25519 @noble/hashes qrcode zustand
# copy this folder's src/ into a Next.js 16 app-router project (or run in place)
bun run dev
```

Flows: Manager unlock → GENERATE KEYSTORE → issue license → copy envelope →
CLIENT gate paste → verify & unlock → CONNECT → threat scenarios (calm /
throttling / active DPI / blackout) → diagnostics console → tampered-license
demo → expired-license demo → FA/EN RTL toggle.
