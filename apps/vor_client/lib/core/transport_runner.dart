/// Transport runners — the platform tunnel implementations behind the engine.
///  * Android: flutter_v2ray (Xray core + VpnService, tun2socks).
///  * Windows: xray.exe child process bound to 127.0.0.1:10808 (+ optional
///    goodbyeDPI-style fragmentation driver started by the installer).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_v2ray/flutter_v2ray.dart';
import 'package:path_provider/path_provider.dart';

import 'vpn_engine.dart';

class AndroidV2RayRunner extends TransportRunner {
  FlutterV2ray? _v2ray;
  StreamSubscription? _sub;
  bool _running = false;
  final List<String> _grantedPermissions = [];

  Future<FlutterV2ray> _init() async {
    if (_v2ray != null) return _v2ray!;
    final completer = Completer<FlutterV2ray>();
    _v2ray = FlutterV2ray(
      onStatusChanged: (status) {
        if (!completer.isCompleted) completer.complete(_v2ray!);
      },
    );
    await _v2ray!.initializeV2Ray();
    return completer.future;
  }

  @override
  Future<void> start(String xrayConfigJson, {void Function(String)? onLog}) async {
    final v2ray = await _init();
    if (!await v2ray.requestVpnPermission()) {
      throw Exception('VPN permission denied by operator');
    }
    _grantedPermissions.add('vpn');
    // flutter_v2ray accepts the full Xray JSON as the config; SOCKS inbound
    // is remapped by the plugin to the VpnService tun interface.
    await v2ray.startV2Ray(
      config: xrayConfigJson,
      notificationTitle: 'VOR Secure Tunnel',
      notificationMessage: 'محافظت فعال — ChaCha20-Poly1305',
    );
    _running = true;
    onLog?.call('VpnService tun interface up — xray core started');
  }

  @override
  Future<void> stop() async {
    try {
      await _v2ray?.stopV2Ray();
    } finally {
      _running = false;
    }
  }

  @override
  bool get isRunning => _running;
}

class WindowsXrayRunner extends TransportRunner {
  Process? _proc;
  File? _configFile;

  @override
  Future<void> start(String xrayConfigJson, {void Function(String)? onLog}) async {
    final dir = await getApplicationSupportDirectory();
    final coreDir = Directory('${dir.path}\\core');
    if (!await coreDir.exists()) {
      throw Exception('xray core not found at ${coreDir.path} — reinstall VOR');
    }
    _configFile = File('${dir.path}\\vor-xray.json');
    await _configFile!.writeAsString(const JsonEncoder.withIndent('  ').convert(jsonDecode(xrayConfigJson)));
    _proc = await Process.start(
      '${coreDir.path}\\xray.exe',
      ['run', '-c', _configFile!.path],
      mode: ProcessStartMode.detachedWithStdio,
    );
    _proc!.stdout.transform(utf8.decoder).listen((l) => onLog?.call(l.trim()));
    _proc!.stderr.transform(utf8.decoder).listen((l) => onLog?.call(l.trim()));
    // Wait briefly and verify the SOCKS inbound is listening.
    await Future.delayed(const Duration(milliseconds: 1200));
    final sock = await _probeSocks();
    if (!sock) throw Exception('xray SOCKS inbound 127.0.0.1:10808 did not open');
    onLog?.call('xray core running — SOCKS 127.0.0.1:10808 / HTTP 127.0.0.1:10809');
  }

  Future<bool> _probeSocks() async {
    try {
      final s = await Socket.connect('127.0.0.1', 10808, timeout: const Duration(milliseconds: 800));
      s.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> stop() async {
    _proc?.kill(ProcessSignal.sigterm);
    _proc = null;
    final f = _configFile;
    if (f != null && await f.exists()) await f.delete().catchError((_) => f);
  }

  @override
  bool get isRunning => _proc != null;
}

TransportRunner? platformRunner() {
  if (Platform.isAndroid) return AndroidV2RayRunner();
  if (Platform.isWindows) return WindowsXrayRunner();
  // iOS: NetworkExtension packet tunnel provider (ships via CI build;
  // same xray JSON is consumed by the extension's xray-core library).
  return null;
}
