/**
 * Subscription / share-link parsing — TS mirror of vor-engine subscription.rs.
 * vless:// vmess:// trojan:// ss:// plus whole base64 subscription lists.
 * 100% local.
 */
import { b64DecodeForgiving } from './crypto';

export interface ProfileEndpoint {
  tag: string;
  address: string;
  port: number;
  uuid: string;
  sni?: string;
  public_key?: string;
  short_id?: string;
  path?: string;
  host?: string;
  password?: string;
  encryption?: string;
  security?: string;
  net?: string;
}

export interface ParsedProfile {
  protocol: string; // vless | vmess | trojan | shadowsocks
  endpoint: ProfileEndpoint;
  raw: string;
}

export type ParseError =
  | { kind: 'empty' }
  | { kind: 'unsupported_scheme'; scheme: string }
  | { kind: 'malformed'; reason: string };

export type ParseResult = { ok: true; profile: ParsedProfile } | { ok: false; error: ParseError };

function err(kind: ParseError['kind'], reason = ''): ParseError {
  if (kind === 'empty') return { kind: 'empty' };
  if (kind === 'unsupported_scheme') return { kind, scheme: reason };
  return { kind: 'malformed', reason };
}

function urldecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function splitQuery(fragment: string): { authority: string; tag?: string; params: [string, string][] } {
  const [mainNoTag, tag] = fragment.split('#', 2);
  const [authority, qs] = mainNoTag.split('?', 2);
  const params: [string, string][] = [];
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=', 2);
      if (k) params.push([k, urldecode(v ?? '')]);
    }
  }
  return { authority, tag, params };
}

function queryGet(params: [string, string][], key: string): string | undefined {
  return params.find(([k]) => k === key)?.[1];
}

function parseHostPort(s: string): { host: string; port: number } | null {
  const t = s.replace(/\/+$/, '');
  const idx = t.lastIndexOf(':');
  if (idx < 0) return null;
  const host = t.slice(0, idx);
  const port = Number.parseInt(t.slice(idx + 1), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { host: host.replace(/^\[|\]$/g, ''), port };
}

export function parseLink(link: string): ParseResult {
  const l = link.trim();
  if (!l) return { ok: false, error: err('empty') };
  if (l.startsWith('vless://')) return parseVless(l.slice('vless://'.length));
  if (l.startsWith('vmess://')) return parseVmess(l.slice('vmess://'.length));
  if (l.startsWith('trojan://')) return parseTrojan(l.slice('trojan://'.length));
  if (l.startsWith('ss://')) return parseSs(l.slice('ss://'.length));
  const scheme = l.split('://')[0] ?? '';
  return { ok: false, error: err('unsupported_scheme', scheme) };
}

function parseVless(rest: string): ParseResult {
  const { authority, tag, params } = splitQuery(rest);
  const at = authority.indexOf('@');
  if (at < 0) return { ok: false, error: err('malformed', 'vless missing @') };
  const userinfo = authority.slice(0, at);
  const hostport = authority.slice(at + 1);
  const hp = parseHostPort(hostport);
  if (!hp) return { ok: false, error: err('malformed', 'host:port') };
  return {
    ok: true,
    profile: {
      protocol: 'vless',
      endpoint: {
        tag: tag ?? 'vless',
        address: hp.host,
        port: hp.port,
        uuid: urldecode(userinfo),
        sni: queryGet(params, 'sni'),
        public_key: queryGet(params, 'pbk'),
        short_id: queryGet(params, 'sid'),
        path: queryGet(params, 'path'),
        host: queryGet(params, 'host'),
        security: queryGet(params, 'security'),
        net: queryGet(params, 'type'),
      },
      raw: `vless://${rest}`,
    },
  };
}

function parseVmess(rest: string): ParseResult {
  const bytes = b64DecodeForgiving(rest);
  if (!bytes) return { ok: false, error: err('malformed', 'base64') };
  const text = new TextDecoder().decode(bytes);
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: err('malformed', `vmess json: ${String(e)}`) };
  }
  const add = typeof v.add === 'string' ? v.add : undefined;
  if (!add) return { ok: false, error: err('malformed', 'vmess add') };
  let port: number | undefined;
  if (typeof v.port === 'number') port = v.port;
  else if (typeof v.port === 'string') port = Number.parseInt(v.port, 10);
  if (!port || port <= 0 || port > 65535) return { ok: false, error: err('malformed', 'vmess port') };
  return {
    ok: true,
    profile: {
      protocol: 'vmess',
      endpoint: {
        tag: typeof v.ps === 'string' ? v.ps : 'vmess',
        address: add,
        port,
        uuid: typeof v.id === 'string' ? v.id : '',
        sni: typeof v.sni === 'string' ? v.sni : undefined,
        path: typeof v.path === 'string' ? v.path : undefined,
        host: typeof v.host === 'string' ? v.host : undefined,
        encryption: typeof v.scy === 'string' ? v.scy : undefined,
        net: typeof v.net === 'string' ? v.net : undefined,
      },
      raw: `vmess://${rest}`,
    },
  };
}

function parseTrojan(rest: string): ParseResult {
  const { authority, tag, params } = splitQuery(rest);
  const at = authority.indexOf('@');
  if (at < 0) return { ok: false, error: err('malformed', 'trojan missing @') };
  const hp = parseHostPort(authority.slice(at + 1));
  if (!hp) return { ok: false, error: err('malformed', 'host:port') };
  return {
    ok: true,
    profile: {
      protocol: 'trojan',
      endpoint: {
        tag: tag ?? 'trojan',
        address: hp.host,
        port: hp.port,
        uuid: '',
        sni: queryGet(params, 'sni'),
        path: queryGet(params, 'path'),
        host: queryGet(params, 'host'),
        password: urldecode(authority.slice(0, at)),
      },
      raw: `trojan://${rest}`,
    },
  };
}

function parseSs(rest: string): ParseResult {
  const [main, tag] = rest.split('#', 2);
  const at = main.indexOf('@');
  if (at >= 0) {
    const bytes = b64DecodeForgiving(main.slice(0, at));
    if (!bytes) return { ok: false, error: err('malformed', 'base64') };
    const cred = new TextDecoder().decode(bytes);
    const ci = cred.indexOf(':');
    if (ci < 0) return { ok: false, error: err('malformed', 'ss cred') };
    const hp = parseHostPort(main.slice(at + 1));
    if (!hp) return { ok: false, error: err('malformed', 'host:port') };
    return {
      ok: true,
      profile: {
        protocol: 'shadowsocks',
        endpoint: {
          tag: tag ?? 'ss',
          address: hp.host,
          port: hp.port,
          uuid: '',
          password: cred.slice(ci + 1),
          encryption: cred.slice(0, ci),
        },
        raw: `ss://${rest}`,
      },
    };
  }
  const bytes = b64DecodeForgiving(main);
  if (!bytes) return { ok: false, error: err('malformed', 'base64') };
  const all = new TextDecoder().decode(bytes);
  const ai = all.lastIndexOf('@');
  if (ai < 0) return { ok: false, error: err('malformed', 'ss missing @') };
  const ci = all.indexOf(':');
  if (ci < 0) return { ok: false, error: err('malformed', 'ss cred') };
  const hp = parseHostPort(all.slice(ai + 1));
  if (!hp) return { ok: false, error: err('malformed', 'host:port') };
  return {
    ok: true,
    profile: {
      protocol: 'shadowsocks',
      endpoint: {
        tag: tag ?? 'ss',
        address: hp.host,
        port: hp.port,
        uuid: '',
        password: all.slice(ci + 1, ai),
        encryption: all.slice(0, ci),
      },
      raw: `ss://${rest}`,
    },
  };
}

/** Parse a whole subscription payload: base64 blob OR newline-separated links. */
export function parseSubscription(payload: string): ParseResult[] {
  const trimmed = payload.trim();
  if (!trimmed) return [{ ok: false, error: err('empty') }];
  let text = trimmed;
  if (!trimmed.includes('://')) {
    const bytes = b64DecodeForgiving(trimmed);
    if (!bytes) return [{ ok: false, error: err('malformed', 'base64') }];
    text = new TextDecoder().decode(bytes);
  }
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(parseLink);
}

/** Compose the share link for the active profile (used for local QR). */
export function composeShareLink(p: ParsedProfile): string {
  return p.raw;
}
