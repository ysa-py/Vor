/// VOR FFI — stable C ABI bridge to the Rust core (vor-ffi crate).
///
/// All functions are JSON-in/JSON-out; results MUST be freed via
/// [freeCString]. The native library is bundled per-platform:
///   Android: libvor_ffi.so (arm64-v8a, armeabi-v7a, x86_64)
///   Windows: vor_ffi.dll
///   iOS:     linked statically into the Runner (see ios patch script).
library;

import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

typedef _StringFn = Pointer<Utf8> Function();
typedef _StringArgFn = Pointer<Utf8> Function(Pointer<Utf8>);
typedef _FreeFn = Void Function(Pointer<Utf8>);
typedef _FreeDart = void Function(Pointer<Utf8>);

class VorCore {
  VorCore._();
  static VorCore? _instance;
  static VorCore get I => _instance ??= VorCore._();

  late DynamicLibrary _lib;
  late _StringFn _hwidGet;
  late _StringArgFn _licenseVerify;
  late _StringArgFn _engineDecide;
  late _StringArgFn _dpiClassify;
  late _StringArgFn _xrayBuild;
  late _StringArgFn _subscriptionParse;
  late _FreeDart _free;
  bool _loaded = false;

  DynamicLibrary _open() {
    if (Platform.isAndroid) return DynamicLibrary.open('libvor_ffi.so');
    if (Platform.isWindows) return DynamicLibrary.open('vor_ffi.dll');
    return DynamicLibrary.process(); // iOS: static link
  }

  void ensureLoaded() {
    if (_loaded) return;
    _lib = _open();
    _hwidGet = _lib
        .lookupFunction<_StringFn, _StringFn>('vor_hwid_get');
    _licenseVerify = _lib
        .lookupFunction<_StringArgFn, _StringArgFn>('vor_license_verify');
    _engineDecide = _lib
        .lookupFunction<_StringArgFn, _StringArgFn>('vor_engine_decide');
    _dpiClassify = _lib
        .lookupFunction<_StringArgFn, _StringArgFn>('vor_dpi_classify');
    _xrayBuild =
        _lib.lookupFunction<_StringArgFn, _StringArgFn>('vor_xray_build');
    _subscriptionParse = _lib
        .lookupFunction<_StringArgFn, _StringArgFn>('vor_subscription_parse');
    _free = _lib.lookupFunction<_FreeFn, _FreeDart>('vor_string_free');
    _loaded = true;
  }

  Map<String, dynamic> _call(String Function(Pointer<Utf8>) fn, String json) {
    ensureLoaded();
    final arg = json.toNativeUtf8();
    try {
      final out = fn(arg);
      if (out == nullptr) {
        return {'ok': false, 'code': 'E_FFI', 'message': 'null from core'};
      }
      final s = out.toDartString();
      _free(out);
      return jsonDecode(s) as Map<String, dynamic>;
    } finally {
      malloc.free(arg);
    }
  }

  String get hwid {
    ensureLoaded();
    final out = _hwidGet();
    final s = out.toDartString();
    _free(out);
    return (jsonDecode(s) as Map<String, dynamic>)['hwid'] as String;
  }

  /// Full offline verification (signature, expiry, HWID, revocation).
  Map<String, dynamic> verifyLicense({
    required String envelope,
    required Map<String, dynamic> trustedKeys,
    required int nowSecs,
    String? hwid,
  }) =>
      _call(_licenseVerify, jsonEncode({
        'envelope': envelope,
        'trusted_keys': trustedKeys,
        'now': nowSecs,
        'hwid': hwid,
      }));

  Map<String, dynamic> engineDecide(Map<String, dynamic> request) =>
      _call(_engineDecide, jsonEncode(request));

  Map<String, dynamic> dpiClassify(Map<String, dynamic> features) =>
      _call(_dpiClassify, jsonEncode({'features': features}));

  Map<String, dynamic> buildXrayConfig({
    required Map<String, dynamic> profile,
    String protocol = 'vless',
    Map<String, dynamic>? hardening,
  }) =>
      _call(_xrayBuild, jsonEncode({
        'profile': profile,
        'protocol': protocol,
        'hardening': hardening,
      }));

  Map<String, dynamic> parseSubscription(String payload) =>
      _call(_subscriptionParse, jsonEncode({'payload': payload}));
}
