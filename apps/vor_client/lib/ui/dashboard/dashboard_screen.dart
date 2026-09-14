import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../l10n/app_localizations.dart';
import '../theme.dart';
import 'dial.dart';

/// View B-1 — Tunnel dashboard: dial, session clock, endpoint/transport
/// explanation, blackout banner. (Throughput series live in Analytics.)
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context)!;
    final engine = ref.watch(engineProvider);
    final connected = engine.state == TunnelState.connected;
    final busy = switch (engine.state) {
      TunnelState.preparing ||
      TunnelState.checkingNetwork ||
      TunnelState.selectingTransport ||
      TunnelState.connecting ||
      TunnelState.handshake ||
      TunnelState.reconnecting ||
      TunnelState.switchingTransport =>
        true,
      _ => false,
    };
    final stateColor = connected
        ? VorColors.sec
        : busy
            ? VorColors.amberSoft
            : engine.state == TunnelState.configError
                ? VorColors.crimson
                : VorColors.muted;

    final stateLabel = switch (engine.state) {
      TunnelState.idle => l.stateIdle,
      TunnelState.preparing => l.statePreparing,
      TunnelState.checkingNetwork => l.stateChecking,
      TunnelState.selectingTransport => l.stateSelecting,
      TunnelState.connecting => l.stateConnecting,
      TunnelState.handshake => l.stateHandshake,
      TunnelState.connected => l.stateConnected,
      TunnelState.reconnecting => l.stateReconnecting,
      TunnelState.switchingTransport => l.stateSwitching,
      TunnelState.diagnosing => l.stateDiagnosing,
      TunnelState.licenseRequired => l.license,
      TunnelState.licenseExpired => l.errE_EXPIRED,
      TunnelState.configError => l.errGate,
    };

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Endpoint micro-bar.
        VorPanel(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              VorStatusChip(label: engine.selected?.endpointId ?? 'AUTO', color: VorColors.sec, pulse: connected),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  engine.selected?.reasons.join(' • ') ?? l.stateIdle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: VorTypography.labelSm(context).copyWith(color: VorColors.muted),
                ),
              ),
              if (engine.blackout)
                const Padding(
                  padding: EdgeInsets.only(left: 8),
                  child: Icon(Icons.cloud_off, size: 16, color: VorColors.amberSoft),
                ),
            ],
          ),
        ),
        if (engine.blackout) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: VorColors.amberSoft.withValues(alpha: .08),
              border: Border.all(color: VorColors.amberSoft.withValues(alpha: .4)),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(children: [
              const Icon(Icons.warning_amber, size: 16, color: VorColors.amberSoft),
              const SizedBox(width: 8),
              Expanded(child: Text(l.blackoutBanner, style: VorTypography.labelMd(context).copyWith(color: VorColors.amberSoft))),
            ]),
          ),
        ],
        const SizedBox(height: 10),
        // Dial card.
        VorPanel(
          child: Column(
            children: [
              const SizedBox(height: 8),
              ConnectionDial(
                connected: connected,
                busy: busy,
                stateColor: stateColor,
                label: connected ? 'ARMED' : 'DISARMED',
                onTap: () async {
                  final engine = ref.read(engineProvider);
                  if (connected) {
                    await engine.disconnect();
                  } else if (!busy) {
                    unawaitedSafe(engine.connect());
                  }
                },
              ),
              const SizedBox(height: 12),
              VorStatusChip(label: stateLabel, color: stateColor, pulse: connected),
              const SizedBox(height: 6),
              AnimatedBuilder(
                animation: engine,
                builder: (_, __) {
                  final d = engine.sessionDuration;
                  String two(int v) => v.toString().padLeft(2, '0');
                  final clock = '${two(d.inHours)}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}';
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.schedule, size: 14, color: VorColors.faint),
                      const SizedBox(width: 6),
                      Text(clock, style: VorTypography.labelMd(context).copyWith(color: VorColors.inkVar)),
                    ],
                  );
                },
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
        const SizedBox(height: 10),
        // Selected route details.
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel('${l.endpoint} / ${l.transport}'),
              const SizedBox(height: 8),
              _kv(context, l.endpoint, engine.selected?.endpointId ?? '—'),
              _kv(context, l.transport, engine.transport),
              _kv(context, 'SCORE', engine.selected == null
                  ? '—'
                  : engine.selected!.score.toStringAsFixed(1)),
              if (engine.attempt > 0) _kv(context, 'RETRY', '${engine.attempt + 1}/5'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kv(BuildContext context, String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: [
            SizedBox(width: 110, child: VorMicroLabel(k)),
            Expanded(
              child: Text(v, style: VorTypography.labelMd(context), textAlign: TextAlign.right),
            ),
          ],
        ),
      );
}

void unawaitedSafe(Future<void> f) {
  f.catchError((_) {});
}
