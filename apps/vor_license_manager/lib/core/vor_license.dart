/// VOR licensing core — pure-Dart mirror of the Rust `vor-license` crate.
///
/// The Manager is the ONLY component holding the private signing key (air-gapped
/// operation). Clients receive exclusively the trusted public-key bundle.
library;

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

final _algo = Ed25519();

String canonicalJson(Object node) {
  final buf = StringBuffer();
  _write(node, buf);
  return buf.toString();
}

void _write(Object node, StringBuffer out) {
  switch (node) {
    case null:
      out.write('null');
    case bool b:
      out.write(b ? 'true' : 'false');
    case num n:
      out.write(_numToJson(n));
    case String s:
      out.write(jsonEncode(s));
    case List l:
      out.write('[');
      for (var i = 0; i < l.length; i++) {
        if (i > 0) out.write(',');
        _write(l[i], out);
      }
      out.write(']');
    case Map m:
      final keys = m.keys.cast<String>().toList()..sort();
      out.write('{');
      for (var i = 0; i < keys.length; i++) {
        if (i > 0) out.write(',');
        out.write(jsonEncode(keys[i]));
        out.write(':');
        _write(m[keys[i]], out);
      }
      out.write('}');
    default:
      throw ArgumentError('unsupported canonical node: ${node.runtimeType}');
  }
}

/// serde_json-compatible number rendering (int without .0).
String _numToJson(num n) {
  if (n is int) return n.toString();
  if (n == n.roundToDouble() && n.abs() < 1e15) return n.toInt().toString();
  return n.toString();
}

String b64url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

Uint8List b64urlDecode(String s) {
  var clean = s.trim().replaceAll('-', '_').replaceAll('_', '/') // normalize
      ;
  // Undo normalization order safely.
  clean = s.trim().replaceAll('-', '+').replaceAll('_', '/');
  while (clean.length % 4 != 0) {
    clean += '=';
  }
  return base64.decode(clean);
}

String sha256Hex(List<int> data) {
  final h = Sha256().newHashSink();
  h.add(data);
  h.close();
  return bytesToHex(h.unwrap().bytes);
}

String bytesToHex(List<int> b) =>
    b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

Uint8List hexToBytes(String hex) {
  final out = Uint8List(hex.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}

String deriveKeyId(List<int> publicKey) =>
    'VLA-${sha256Hex(publicKey).substring(0, 16)}';

class VorKeyStore {
  static const version = 1;
  SimpleKeyPair keyPair;
  String signingKeyHex;
  String publicKeyHex;
  String activeKeyId;
  Map<String, dynamic> keys;

  VorKeyStore._(this.keyPair, this.signingKeyHex, this.publicKeyHex, this.activeKeyId, this.keys);

  static Future<VorKeyStore> generate(int nowSecs) async {
    final kp = await _algo.newKeyPair();
    final pk = await kp.extractPublicKey();
    final pkBytes = pk.bytes;
    final keyId = deriveKeyId(pkBytes);
    final skBytes = await kp.extractPrivateKeyBytes();
    return VorKeyStore._(
      kp,
      bytesToHex(skBytes),
      bytesToHex(pkBytes),
      keyId,
      {
        keyId: {
          'key_id': keyId,
          'public': bytesToHex(pkBytes),
          'status': 'active',
          'created_at': nowSecs,
          'note': 'master key',
        }
      },
    );
  }

  Map<String, dynamic> toJson() => {
        'keystore_version': version,
        'signing_key': signingKeyHex,
        'active_key_id': activeKeyId,
        'keys': keys,
      };

  static Future<VorKeyStore> fromJson(Map<String, dynamic> j) async {
    final sk = hexToBytes(j['signing_key'] as String);
    final keyPair = await _algo.newKeyPairFromSeed(sk);
    return VorKeyStore._(
      keyPair,
      bytesToHex(sk),
      j['keys'][j['active_key_id']]['public'] as String,
      j['active_key_id'] as String,
      (j['keys'] as Map).cast<String, dynamic>(),
    );
  }

  /// Soft rotation keeps old keys verifiable; hard rotation retires them all.
  Future<String> rotate(int nowSecs, {bool retireOld = false}) async {
    if (retireOld) {
      keys.updateAll((_, v) {
        if (v['status'] == 'active') {
          return {...v, 'status': 'retired', 'note': '${v['note']} (retired at rotation $nowSecs)'};
        }
        return v;
      });
    }
    final kp = await _algo.newKeyPair();
    final pk = await kp.extractPublicKey();
    final keyId = deriveKeyId(pk.bytes);
    final skBytes = await kp.extractPrivateKeyBytes();
    keys[keyId] = {
      'key_id': keyId,
      'public': bytesToHex(pk.bytes),
      'status': 'active',
      'created_at': nowSecs,
      'note': 'rotated master key',
    };
    keyPair = kp;
    signingKeyHex = bytesToHex(skBytes);
    publicKeyHex = bytesToHex(pk.bytes);
    activeKeyId = keyId;
    return keyId;
  }
}

const kProductId = 'VOR';
const kFormatVersion = 2;
const kEnvelopePrefix = 'VORLIC1';

const kTiers = ['standard', 'pro', 'enterprise'];
const kEntitlements = [
  'core_tunnel',
  'stealth_engine',
  'relay_chains',
  'unlimited_devices',
  'priority_fleet',
];

Map<String, dynamic> buildPayload({
  required int nowSecs,
  required int days,
  required String keyId,
  required String tier,
  required List<String> entitlements,
  required int maxDevices,
  required List<String> boundHwids,
  String? metadata,
  String? licenseId,
  int? notBefore,
}) {
  final nb = notBefore ?? nowSecs;
  return {
    'license_version': kFormatVersion,
    'license_id': licenseId ?? _uuidV4(),
    'product': kProductId,
    'key_id': keyId,
    'issued_at': nowSecs,
    'not_before': nb,
    'expires_at': nb + days * 86400,
    'license_tier': tier,
    'entitlements': entitlements,
    'device_policy': {
      'max_devices': maxDevices,
      'bound_hwids': boundHwids.map(normalizeHwid).toList(),
    },
    if (metadata != null && metadata.trim().isNotEmpty) 'metadata': metadata.trim(),
  };
}

String _uuidV4() {
  final rand = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  rand[6] = (rand[6] & 0x0f) | 0x40;
  rand[8] = (rand[8] & 0x3f) | 0x80;
  final h = bytesToHex(rand);
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20, 32)}';
}

String normalizeHwid(String s) {
  final lower = s.trim().toLowerCase();
  return lower.startsWith('hwid-sha256-') ? lower : 'hwid-sha256-${lower.replaceAll('0x', '')}';
}

Future<String> issueLicenseEnvelope(VorKeyStore ks, Map<String, dynamic> payload) async {
  final canonical = canonicalJson(payload);
  final signature = await _algo.sign(
    utf8.encode(canonical),
    keyPair: ks.keyPair,
  );
  return '$kEnvelopePrefix.${b64url(utf8.encode(canonical))}.${b64url(signature.bytes)}.${b64url(hexToBytes(ks.publicKeyHex))}';
}

Map<String, dynamic> licenseFileDoc(String envelope) => {
      'format': 'VORLIC',
      'version': kFormatVersion,
      'envelope': envelope,
    };

/// Tamper-evident hash-chained audit ledger (mirrors audit.rs).
List<Map<String, dynamic>> appendAudit(List<Map<String, dynamic>> entries, String action, String detail, int ts) {
  final prev = entries.isEmpty ? 'GENESIS' : entries.last['hash'] as String;
  final seq = entries.length;
  final body = canonicalJson({'seq': seq, 'ts': ts, 'action': action, 'detail': detail, 'prev_hash': prev});
  final hash = sha256Hex(utf8.encode(body));
  return [
    ...entries,
    {'seq': seq, 'ts': ts, 'action': action, 'detail': detail, 'prev_hash': prev, 'hash': hash},
  ];
}

bool verifyAuditChain(List<Map<String, dynamic>> entries) {
  var prev = 'GENESIS';
  for (var i = 0; i < entries.length; i++) {
    final e = entries[i];
    final body = canonicalJson({
      'seq': e['seq'], 'ts': e['ts'], 'action': e['action'],
      'detail': e['detail'], 'prev_hash': e['prev_hash'],
    });
    if (e['prev_hash'] != prev || sha256Hex(utf8.encode(body)) != e['hash']) return false;
    prev = e['hash'] as String;
  }
  return true;
}
