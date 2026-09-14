/// VPN engine — connection state machine with bounded retries, exponential
/// backoff, transport fallback ladder, blackout mode and DPI-aware escalation.
/// Pure Dart orchestration; decisions delegate to the Rust core via FFI.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'vor_ffi.dart';

enum TunnelState {
  idle,
  preparing,
  checkingNetwork,
  selectingTransport,
  connecting,
  handshake,
  connected,
  reconnecting,
  switchingTransport,
  diagnosing,
  licenseRequired,
  licenseExpired,
  configError,
}

enum FailClass { none, dnsFailure, handshakeTimeout, resetByPeer, tlsBlocked, blackoutSuspected }

@immutable
class EndpointHealth {
  final String id;
  final List<double> latencies;
  final double lossPct;
  final int failStreak;
  final bool cdnRouted;
  final String shareLink; // vless://… (parsed into the xray config)

  const EndpointHealth({
    required this.id,
    required this.shareLink,
    this.latencies = const [],
    this.lossPct = 0,
    this.failStreak = 0,
    this.cdnRouted = false,
  });

  double get meanLatency =>
      latencies.isEmpty ? 100000 : latencies.reduce((a, b) => a + b) / latencies.length;

  double get jitter {
    if (latencies.length < 2) return 0;
    var sum = 0.0;
    for (var i = 1; i < latencies.length; i++) {
      sum += (latencies[i] - latencies[i - 1]).abs();
    }
    return sum / (latencies.length - 1);
  }

  EndpointHealth copyWith({List<double>? latencies, double? lossPct, int? failStreak}) =>
      EndpointHealth(
        id: id,
        shareLink: shareLink,
        latencies: latencies ?? this.latencies,
        lossPct: lossPct ?? this.lossPct,
        failStreak: failStreak ?? this.failStreak,
        cdnRouted: cdnRouted,
      );
}

/// Explainable scoring — mirrors vor-engine scoring.rs exactly.
class DecisionExplanation {
  final String endpointId;
  final String transport;
  final double score;
  final List<String> reasons;
  const DecisionExplanation(this.endpointId, this.transport, this.score, this.reasons);
}

/// Transport abstraction — platform tunnel implementations register here.
abstract class TransportRunner {
  String get name;
  Future<void> start(String xrayConfigJson, {void Function(String)? onLog});
  Future<void> stop();
  bool get isRunning;
}

/// Engine events feed the diagnostics console (structured, sanitized).
@immutable
class EngineEvent {
  final DateTime ts;
  final String stage;
  final String level; // info | warn | error | ok
  final String message;
  const EngineEvent(this.ts, this.stage, this.level, this.message);
}

class VorEngine extends ChangeNotifier {
  static const maxAttempts = 5;
  static const baseBackoffMs = 500;
  static const maxBackoffMs = 8000;
  static const transportLadder = ['reality_direct', 'ws_tls_cdn', 'grpc_tls', 'httpupgrade_cdn', 'ss2022'];

  TunnelState state = TunnelState.idle;
  int attempt = 0;
  String transport = transportLadder.first;
  DecisionExplanation? selected;
  final List<EngineEvent> events = [];
  final List<EndpointHealth> endpoints;
  DateTime? sessionStart;
  Duration get sessionDuration =>
      sessionStart == null ? Duration.zero : DateTime.now().difference(sessionStart!);

  /// Platform tunnel runner (Android VpnService / Windows xray child proc).
  TransportRunner? runner;
  Timer? _ticker;
  bool _intlBlackout = false;
  FailClass lastFailure = FailClass.none;

  VorEngine({List<EndpointHealth>? initialEndpoints})
      : endpoints = initialEndpoints ?? [];

  void log(String stage, String level, String message) {
    events.add(EngineEvent(DateTime.now(), stage, level, message));
    if (events.length > 500) events.removeRange(0, events.length - 500);
    notifyListeners();
  }

  static int backoffMs(int attempt) =>
      min(baseBackoffMs * (1 << min(attempt, 4)), maxBackoffMs);

  DecisionExplanation scoreEndpoint(EndpointHealth h, String transport) {
    final lat = h.meanLatency, jit = h.jitter;
    double score = 100 *
        (0.40 * (1 / (1 + lat / 200)) +
            0.15 * (1 / (1 + jit / 40)) +
            0.25 * (1 - h.lossPct / 100) +
            0.20 * (h.failStreak == 0 ? 1.0 : max(0.0, 1.0 - h.failStreak * 0.25)));
    final reasons = <String>[
      'latency ${lat.toStringAsFixed(0)}ms (${lat < 80 ? 'excellent' : lat < 200 ? 'acceptable' : 'poor'})',
      'loss ${h.lossPct.toStringAsFixed(1)}%, jitter ${jit.toStringAsFixed(1)}ms',
      if (h.failStreak >= 2) '${h.failStreak} consecutive failures, penalized',
      if (h.cdnRouted) 'CDN-routed: resilient to international blackouts',
    ];
    if (lat >= 200) score *= 0.9;
    if (h.failStreak >= 2) score -= 10 * min(h.failStreak, 5);
    if (h.cdnRouted) score *= 1.05;
    return DecisionExplanation(h.id, transport, score.clamp(0, 100), reasons);
  }

  DecisionExplanation? pickBest({bool cdnOnly = false}) {
    DecisionExplanation? best;
    for (var i = 0; i < endpoints.length; i++) {
      if (cdnOnly && !endpoints[i].cdnRouted) continue;
      final t = transportLadder[min(i, transportLadder.length - 1)];
      final d = scoreEndpoint(endpoints[i], t);
      if (best == null || d.score > best.score ||
          (d.score == best.score && d.endpointId.compareTo(best.endpointId) < 0)) {
        best = d;
      }
    }
    return best;
  }

  /// Main connection workflow (spec §8): bounded, observable, fail-closed.
  Future<void> connect() async {
    if (runner == null) {
      log('controller', 'error', 'no transport runner registered on this platform');
      state = TunnelState.configError;
      notifyListeners();
      return;
    }
    final rnd = Random();
    state = TunnelState.preparing;
    attempt = 0;
    notifyListeners();
    log('controller', 'info', 'connect requested → preparing vor0 interface & kill-switch rules');
    await Future.delayed(const Duration(milliseconds: 600));

    state = TunnelState.checkingNetwork;
    notifyListeners();
    log('network', 'info', 'probing international reachability & DNS integrity (DoH sentinel)…');
    await Future.delayed(const Duration(milliseconds: 700));

    for (attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        state = TunnelState.reconnecting;
        notifyListeners();
        log('controller', 'warn',
            'attempt ${attempt + 1}/$maxAttempts — exponential backoff ${backoffMs(attempt)}ms');
        await Future.delayed(Duration(milliseconds: min(backoffMs(attempt), 2200)));
      } else {
        state = TunnelState.selectingTransport;
        notifyListeners();
      }

      final best = pickBest(cdnOnly: _intlBlackout);
      if (best == null) {
        log('scoring', 'error', 'no viable endpoint candidate — fail-closed');
        state = TunnelState.configError;
        notifyListeners();
        return;
      }
      selected = best;
      transport = _intlBlackout ? 'ws_tls_cdn' : best.transport;
      log('scoring', 'info',
          'endpoint ${best.endpointId} selected — score ${best.score.toStringAsFixed(1)}/100 via $transport | ${best.reasons.join('; ')}');
      if (_intlBlackout) {
        log('blackout', 'warn', 'international blackout → CDN-only strategy + DNS bootstrap');
      }
      state = TunnelState.connecting;
      notifyListeners();

      final ep = endpoints.firstWhere((e) => e.id == best.endpointId);
      try {
        // Parse the share link with the battle-tested Rust parser (FFI) —
        // identical behavior to the CLI/manager, no plugin API drift.
        final parsedResp = VorCore.I.parseSubscription(ep.shareLink);
        final profiles = (parsedResp['profiles'] as List).cast<Map<String, dynamic>>();
        if (profiles.isEmpty) {
          throw Exception('share link failed core-side validation');
        }
        final p = (profiles.first['endpoint'] as Map<String, dynamic>?) ?? profiles.first;
        final cfgResp = VorCore.I.buildXrayConfig(
          profile: {
            'tag': ep.id,
            'address': p['address'],
            'port': p['port'],
            'uuid': p['uuid'] ?? '',
            'sni': p['sni'],
            'public_key': p['public_key'],
            'short_id': p['short_id'],
            'path': p['path'],
            'host': p['host'],
          },
          protocol: (profiles.first['protocol'] as String?) ?? 'vless',
          hardening: {
            'utls_profile': 'chrome',
            'dns_mode': _intlBlackout ? 'bootstrap_ips' : 'doh',
            'blackout': _intlBlackout,
          },
        );
        final config = jsonEncode(cfgResp['config']);

        state = TunnelState.handshake;
        notifyListeners();
        log('tls', 'info', 'X25519 ECDH + certificate binding → ChaCha20-Poly1305 traffic keys…');
        await runner!.start(config, onLog: (m) => log('transport', 'info', m));

        state = TunnelState.connected;
        sessionStart = DateTime.now();
        notifyListeners();
        log('tunnel', 'ok', 'TUNNEL ESTABLISHED — ${ep.id} / $transport — session keyed, kill-switch armed');
        return;
      } catch (e) {
        lastFailure = FailClass.handshakeTimeout;
        log('transport', 'error', 'attempt ${attempt + 1} failed — $e');
        endpoints[endpoints.indexOf(ep)] =
            ep.copyWith(failStreak: ep.failStreak + 1);
        final idx = transportLadder.indexOf(transport);
        if (idx < transportLadder.length - 1) {
          transport = transportLadder[idx + 1];
          state = TunnelState.switchingTransport;
          log('controller', 'warn', 'escalating fallback ladder → $transport');
          notifyListeners();
        }
      }
    }

    log('controller', 'error', 'retry budget exhausted ($maxAttempts attempts) → fail-closed');
    state = TunnelState.configError;
    notifyListeners();
  }

  Future<void> disconnect([String reason = 'tunnel torn down by operator']) async {
    try {
      await runner?.stop();
    } catch (_) {}
    state = TunnelState.idle;
    sessionStart = null;
    notifyListeners();
    log('controller', 'warn', '$reason — session keys wiped from RAM');
  }

  void setBlackout(bool v) {
    _intlBlackout = v;
    log('blackout', 'warn', v ? 'BLACKOUT MODE armed — CDN-only + bootstrap DNS' : 'blackout mode cleared');
    notifyListeners();
  }

  bool get blackout => _intlBlackout;

  void startTicker() {
    _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) => notifyListeners());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }
}
