/**
 * VOR crypto primitives — browser-side mirror of the Rust core.
 *
 * Ed25519 via @noble/ed25519 (v3) with the synchronous SHA-512 provider
 * supplied by @noble/hashes. All operations run 100% locally (air-gapped
 * philosophy — no network calls, no WebCrypto async paths needed).
 */
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

// Wire the sync SHA-512 provider ONCE at module load (required by noble v3 sync API).
ed.hashes.sha512 = sha512;

export const ed25519 = ed;

export function toHex(bytes: Uint8Array): string {
  return ed.etc.bytesToHex(bytes);
}

export function fromHex(hex: string): Uint8Array {
  return ed.etc.hexToBytes(hex.trim());
}

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  return ed.etc.concatBytes(...arrs);
}

export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(sha256(bytes));
}

export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? sha256(new TextEncoder().encode(data)) : sha256(data);
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/* ------------------------------------------------------------------ */
/* base64url (RFC 4648 §5, no padding) — mirrors Rust URL_SAFE_NO_PAD */
/* ------------------------------------------------------------------ */

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  let clean = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (clean.length % 4 !== 0) clean += '=';
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Forgiving base64 (std/url, pad/no-pad) — mirrors subscription.rs b64_decode_forgiving. */
export function b64DecodeForgiving(s: string): Uint8Array | null {
  const cleaned = s.trim().replace(/[\n\r ]/g, '');
  const variants = [cleaned, cleaned.replace(/-/g, '+').replace(/_/g, '/')];
  for (const v of variants) {
    const padded = v + '='.repeat((4 - (v.length % 4)) % 4);
    try {
      const bin = atob(padded);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      /* try next */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */

/** UUIDv4 from OS entropy (mirrors lib.rs new_license_id). */
export function newUuidV4(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = toHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Random hex string of n bytes. */
export function randomHex(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return toHex(b);
}
