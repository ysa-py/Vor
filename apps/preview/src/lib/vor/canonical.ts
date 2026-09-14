/**
 * Deterministic canonical JSON — exact TS mirror of vor-license canonical.rs.
 *
 * Rules: object keys sorted lexicographically (byte order), no whitespace,
 * shortest RFC-8259 string escapes, integers stay integers.
 * The Ed25519 signature MUST cover exactly this byte form.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

/** Shortest valid JSON string escape (mirrors serde_json). */
function escapeJsonString(s: string): string {
  return JSON.stringify(s);
}

export function canonicalJson(value: JsonValue): string {
  let out = '';
  writeCanonical(value);
  return out;

  function writeCanonical(v: JsonValue): void {
    if (v === null) {
      out += 'null';
      return;
    }
    switch (typeof v) {
      case 'boolean':
        out += v ? 'true' : 'false';
        return;
      case 'number': {
        if (!Number.isFinite(v)) throw new Error('canonical: non-finite number');
        // serde_json round-trip form: integers without decimal point.
        if (Number.isInteger(v) && Math.abs(v) < 9.007199254740991e15) {
          out += String(v);
        } else {
          out += String(v);
        }
        return;
      }
      case 'string':
        out += escapeJsonString(v);
        return;
    }
    if (Array.isArray(v)) {
      out += '[';
      for (let i = 0; i < v.length; i++) {
        if (i > 0) out += ',';
        writeCanonical(v[i]);
      }
      out += ']';
      return;
    }
    // Object: deterministic ordering via byte-wise key sort.
    const keys = Object.keys(v).sort((a, b) => {
      const ea = new TextEncoder().encode(a);
      const eb = new TextEncoder().encode(b);
      const n = Math.min(ea.length, eb.length);
      for (let i = 0; i < n; i++) {
        if (ea[i] !== eb[i]) return ea[i] - eb[i];
      }
      return ea.length - eb.length;
    });
    out += '{';
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out += ',';
      out += escapeJsonString(keys[i]);
      out += ':';
      writeCanonical(v[keys[i]]);
    }
    out += '}';
  }
}

/** Parse then canonicalize in one step (mirrors canonicalize_str). */
export function canonicalizeStr(json: string): string {
  return canonicalJson(JSON.parse(json) as JsonValue);
}
