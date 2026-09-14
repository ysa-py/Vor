/**
 * Browser machine fingerprint — mirror of vor-license hwid.rs.
 *
 * `HWID-SHA256-<64 hex>` — deterministic binding fingerprint. The attributes
 * mixed here are stable on a real device and meaningless across machines.
 * Never transmitted anywhere (offline verification only).
 */
import { sha256Bytes, toHex } from './crypto';

const HWID_SALT_KEY = 'vor.hwidentity';

function feed(parts: string[], s: string): void {
  // 0x1f unit separator avoids attribute-boundary ambiguity (mirrors hwid.rs feed()).
  parts.push(s, '\x1f');
}

function canvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'nocanvas';
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(122, 1, 62, 20);
    ctx.fillStyle = '#0f141c';
    ctx.fillText('VOR HWID \u{1F512}', 2, 15);
    ctx.fillStyle = 'rgba(77,142,255,0.7)';
    ctx.fillText('VOR HWID \u{1F512}', 4, 17);
    return canvas.toDataURL().slice(-96);
  } catch {
    return 'nocanvas';
  }
}

function collectAttributes(): string[] {
  const parts: string[] = [];
  feed(parts, 'vor.hwid.v2');
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav) {
    feed(parts, nav.userAgent ?? '');
    feed(parts, nav.language ?? '');
    feed(parts, String(nav.hardwareConcurrency ?? 0));
    const mem = (nav as { deviceMemory?: number }).deviceMemory;
    feed(parts, String(mem ?? 0));
  }
  if (typeof screen !== 'undefined') {
    feed(parts, `${screen.width}x${screen.height}x${screen.colorDepth}`);
  }
  feed(parts, Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
  feed(parts, String(new Date().getTimezoneOffset()));
  feed(parts, canvasFingerprint());
  return parts;
}

/** Compute (or restore the persisted) machine HWID. */
export function machineHwid(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(HWID_SALT_KEY);
    if (saved && /^HWID-SHA256-[0-9a-f]{64}$/.test(saved)) return saved;
  }
  const digest = toHex(sha256Bytes(collectAttributes().join('')));
  const hwid = `HWID-SHA256-${digest}`;
  try {
    localStorage.setItem(HWID_SALT_KEY, hwid);
  } catch {
    /* private mode — still functional for this session */
  }
  return hwid;
}

/** Normalize any HWID input to canonical lowercase form (mirror of hwid.rs). */
export function normalizeHwid(s: string): string {
  const lower = s.trim().toLowerCase();
  if (lower.startsWith('hwid-sha256-')) return lower;
  return `hwid-sha256-${lower.replace(/^0x/, '')}`;
}

/** Short display form: HWID-SHA256-4b82d3e9…ea0199e8 */
export function hwidDisplay(hwid: string, head = 8, tail = 8): string {
  const hex = hwid.replace(/^HWID-SHA256-/, '');
  if (hex.length <= head + tail) return hwid;
  return `HWID-SHA256-${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
