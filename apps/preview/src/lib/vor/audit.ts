/**
 * Tamper-evident append-only audit log — mirror of vor-license audit.rs.
 *
 * hash = SHA-256(canonical({seq, ts, action, detail, prev_hash}))
 * Any retro-edit breaks the chain and is detectable by verifyChain().
 */
import { canonicalJson } from './canonical';
import { sha256Hex } from './crypto';

export interface AuditEntry {
  seq: number;
  ts: number;
  action: string;
  detail: string;
  prev_hash: string;
  hash: string;
}

export const GENESIS = 'GENESIS';

function hashEntry(e: Omit<AuditEntry, 'hash'>): string {
  const doc = {
    seq: e.seq,
    ts: e.ts,
    action: e.action,
    detail: e.detail,
    prev_hash: e.prev_hash,
  };
  return sha256Hex(canonicalJson(doc));
}

export function appendAudit(entries: AuditEntry[], ts: number, action: string, detail: string): AuditEntry {
  const seq = entries.length;
  const prev_hash = entries.length > 0 ? entries[entries.length - 1].hash : GENESIS;
  const entry: AuditEntry = { seq, ts, action, detail, prev_hash, hash: '' };
  entry.hash = hashEntry(entry);
  return entry;
}

/** Recompute the full chain; returns the first broken seq or -1 if intact. */
export function verifyAuditChain(entries: AuditEntry[]): number {
  let prev = GENESIS;
  for (const e of entries) {
    const expect = hashEntry(e);
    if (e.prev_hash !== prev || e.hash !== expect) return e.seq;
    prev = e.hash;
  }
  return -1;
}

export function auditRoot(entries: AuditEntry[]): string {
  return entries.length > 0 ? entries[entries.length - 1].hash : GENESIS;
}
