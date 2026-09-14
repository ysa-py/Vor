import 'dart:math';

import 'package:flutter/material.dart';

import '../theme.dart';

/// Primary connection actuator — concentric segmented SVG-style rings with a
/// 160px core button (DESIGN.md "VPN Actuation Dial (HUD Mode)").
class ConnectionDial extends StatefulWidget {
  final bool connected;
  final bool busy;
  final Color stateColor;
  final String label; // e.g. DISARMED / ARMED / HANDSHAKE
  final VoidCallback onTap;

  const ConnectionDial({
    super.key,
    required this.connected,
    required this.busy,
    required this.stateColor,
    required this.label,
    required this.onTap,
  });

  @override
  State<ConnectionDial> createState() => _ConnectionDialState();
}

class _ConnectionDialState extends State<ConnectionDial> with SingleTickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 30),
  )..repeat();

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = 224.0;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Ambient glow.
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: widget.stateColor.withValues(alpha: .12),
                  blurRadius: 60,
                  spreadRadius: 8,
                ),
              ],
            ),
          ),
          // Outer rotating segmented rings.
          AnimatedBuilder(
            animation: _spin,
            builder: (_, __) => CustomPaint(
              size: Size.square(size),
              painter: _RingsPainter(
                rotation: _spin.value * 2 * pi,
                track: VorColors.surfHigh,
                accent1: widget.stateColor,
                accent2: VorColors.primAction,
              ),
            ),
          ),
          // Core master button.
          Material(
            color: VorColors.surfHigh,
            shape: const CircleBorder(),
            elevation: 6,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: widget.onTap,
              child: Container(
                width: 148,
                height: 148,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: VorColors.seam, width: 1.5),
                ),
                child: Center(
                  child: Container(
                    width: 118,
                    height: 118,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: VorColors.surfLowest,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        widget.busy
                            ? const SizedBox(
                                width: 34,
                                height: 34,
                                child: CircularProgressIndicator(strokeWidth: 2.4, color: VorColors.amberSoft))
                            : Icon(
                                widget.connected ? Icons.lock : Icons.lock_open,
                                size: 40,
                                color: widget.stateColor,
                              ),
                        const SizedBox(height: 6),
                        Text(
                          widget.label,
                          style: VorTypography.micro(context).copyWith(
                            color: widget.stateColor,
                            letterSpacing: 1.6,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RingsPainter extends CustomPainter {
  final double rotation;
  final Color track;
  final Color accent1;
  final Color accent2;

  _RingsPainter({
    required this.rotation,
    required this.track,
    required this.accent1,
    required this.accent2,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final radii = [size.width / 2 - 4.0, size.width / 2 - 12.0, size.width / 2 - 19.0];
    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = track;

    for (final r in radii) {
      canvas.drawCircle(c, r, trackPaint..color = track.withValues(alpha: .9));
    }

    void arc(double radius, double startDeg, double sweepDeg, Color color, double w) {
      final rect = Rect.fromCircle(center: c, radius: radius);
      canvas.drawArc(
        rect,
        startDeg + rotation,
        sweepDeg * pi / 180,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = w
          ..strokeCap = StrokeCap.round
          ..color = color,
      );
    }

    arc(radii[0], -90, 64, accent1, 2);
    arc(radii[1], -30, 38, accent1.withValues(alpha: .8), 2);
    arc(radii[2], 130, 26, accent2.withValues(alpha: .6), 1.6);
  }

  @override
  bool shouldRepaint(_RingsPainter old) => old.rotation != rotation;
}
