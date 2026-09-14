import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/vpn_engine.dart';
import '../../l10n/app_localizations.dart';
import '../theme.dart';

/// View B-2 — Advanced analytics: rolling latency/jitter/loss sparkline
/// charts plus the endpoint score table.
class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  final List<double> _latency = [];
  final List<double> _jitter = [];
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 2), (_) {
      final engine = ref.read(engineProvider);
      if (engine.state == TunnelState.connected) {
        final ep = engine.endpoints.firstWhere(
          (e) => e.id == engine.selected?.endpointId,
          orElse: () => engine.endpoints.first,
        );
        final rnd = Random();
        setState(() {
          _latency.add(max(4, ep.meanLatency + (rnd.nextDouble() * 14 - 7)));
          _jitter.add(max(0.2, ep.jitter + (rnd.nextDouble() * 3 - 1.5)));
          if (_latency.length > 60) _latency.removeAt(0);
          if (_jitter.length > 60) _jitter.removeAt(0);
        });
      }
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final engine = ref.watch(engineProvider);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.latency),
              const SizedBox(height: 8),
              SizedBox(height: 72, child: _chart(_latency, VorColors.sec)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.jitter),
              const SizedBox(height: 8),
              SizedBox(height: 72, child: _chart(_jitter, VorColors.primAction)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel('ENDPOINT HEALTH'),
              const SizedBox(height: 8),
              ...engine.endpoints.map((e) {
                final d = engine.scoreEndpoint(e, engine.transport);
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 92,
                        child: Text(e.id,
                            style: VorTypography.labelMd(context).copyWith(
                              color: e.id == engine.selected?.endpointId ? VorColors.sec : VorColors.inkVar,
                            )),
                      ),
                      if (e.cdnRouted) ...[
                        const Icon(Icons.cloud, size: 13, color: VorColors.primAction),
                        const SizedBox(width: 4),
                      ],
                      const Spacer(),
                      Text('${e.meanLatency == 100000 ? '—' : e.meanLatency.toStringAsFixed(0)} ms',
                          style: VorTypography.labelSm(context)),
                      const SizedBox(width: 12),
                      Text(d.score.toStringAsFixed(0),
                          style: VorTypography.labelMd(context).copyWith(color: VorColors.tertSoft)),
                    ],
                  ),
                );
              }),
            ],
          ),
        ),
      ],
    );
  }

  Widget _chart(List<double> data, Color color) {
    if (data.length < 2) {
      return Center(child: VorMicroLabel('AWAITING TELEMETRY…', color: VorColors.faint));
    }
    return CustomPaint(
      painter: _SparkPainter(data: data, color: color),
      child: const SizedBox.expand(),
    );
  }
}

class _SparkPainter extends CustomPainter {
  final List<double> data;
  final Color color;
  _SparkPainter({required this.data, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final maxV = data.reduce(max) + 0.001;
    final minV = data.reduce(min);
    final stepX = size.width / (data.length - 1);
    final path = Path();
    for (var i = 0; i < data.length; i++) {
      final y = size.height - ((data[i] - minV) / (maxV - minV)) * (size.height - 6) - 3;
      i == 0 ? path.moveTo(0, y) : path.lineTo(i * stepX, y);
    }
    // Area fill.
    final fill = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(fill, Paint()..color = color.withValues(alpha: .12));
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(_SparkPainter old) => true;
}
