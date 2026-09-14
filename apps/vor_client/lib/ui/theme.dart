/// VOR design system — exact port of tactical_security_licensing_engine
/// DESIGN.md tokens (charcoal obsidian canvas, precision blue, crypto emerald,
/// warning amber, tamper-evident crimson; Inter + JetBrains Mono roles).
library;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Font roles: Inter for UI, JetBrains Mono for every computational string.
/// google_fonts is vendored at build time; set [kOfflineFonts] to bundle TTFs
/// for fully air-gapped builds (see docs/RELEASE.md).
abstract final class VorTypography {
  static TextStyle micro(BuildContext c) => GoogleFonts.jetBrainsMono(
        fontSize: 10, height: 1.1, letterSpacing: 0.8, fontWeight: FontWeight.w600,
        color: c.colorScheme.onSurfaceVariant,
      );
  static TextStyle labelSm(BuildContext c) => GoogleFonts.jetBrainsMono(
        fontSize: 11, letterSpacing: 0.6, fontWeight: FontWeight.w500,
        color: c.colorScheme.onSurfaceVariant,
      );
  static TextStyle labelMd(BuildContext c) => GoogleFonts.jetBrainsMono(
        fontSize: 12, letterSpacing: 0.4, fontWeight: FontWeight.w500,
        color: c.colorScheme.onSurface,
      );
  static TextStyle headlineMd(BuildContext c) => GoogleFonts.inter(
        fontSize: 20, height: 1.4, letterSpacing: -0.1, fontWeight: FontWeight.w600,
        color: c.colorScheme.onSurface,
      );
  static TextStyle bodyMd(BuildContext c) => GoogleFonts.inter(
        fontSize: 14, height: 1.45, color: c.colorScheme.onSurface,
      );
}

abstract final class VorColors {
  static const canvas = Color(0xFF0F141C);
  static const surfLowest = Color(0xFF090E16);
  static const surfLow = Color(0xFF151C28);
  static const surf = Color(0xFF1B2028);
  static const surfHigh = Color(0xFF252A33);
  static const ink = Color(0xFFDEE2EE);
  static const inkVar = Color(0xFFC2C6D6);
  static const muted = Color(0xFF94A3B8);
  static const faint = Color(0xFF64748B);
  static const seam = Color(0xFF2A3447);
  static const seamStrong = Color(0xFF4B5563);
  static const primAction = Color(0xFF3B82F6);
  static const primDeep = Color(0xFF2563EB);
  static const sec = Color(0xFF4EDEA3);
  static const secDeep = Color(0xFF10B981);
  static const amber = Color(0xFFF59E0B);
  static const amberSoft = Color(0xFFFFB95F);
  static const crimson = Color(0xFFEF4444);
  static const errSoft = Color(0xFFFFB4AB);
}

class VorTheme {
  static ThemeData dark() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: VorColors.canvas,
      colorScheme: const ColorScheme.dark(
        surface: VorColors.canvas,
        primary: VorColors.primAction,
        onPrimary: Colors.white,
        secondary: VorColors.sec,
        onSecondary: Color(0xFF003824),
        error: VorColors.crimson,
        onError: Color(0xFFFFDAD6),
        onSurface: VorColors.ink,
        onSurfaceVariant: VorColors.muted,
        outline: VorColors.seam,
        surfaceContainerHighest: VorColors.surfHigh,
      ),
    );
    return base.copyWith(
      dividerTheme: const DividerThemeData(color: VorColors.seam, thickness: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: VorColors.surfLowest,
        constraints: const BoxConstraints(minHeight: 38, maxHeight: 38),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        border: _border(VorColors.seam),
        enabledBorder: _border(VorColors.seam),
        focusedBorder: _border(VorColors.primAction),
        errorBorder: _border(VorColors.crimson),
        hintStyle: VorTypography.labelSm(base).copyWith(color: VorColors.faint),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) =>
            s.contains(WidgetState.selected) ? VorColors.sec : VorColors.seam),
        trackColor: WidgetStateProperty.resolveWith((s) =>
            s.contains(WidgetState.selected) ? VorColors.secDeep.withValues(alpha: .4) : VorColors.surfHigh),
        trackOutlineColor: const WidgetStatePropertyAll(VorColors.seam),
      ),
      sliderTheme: const SliderThemeData(
        activeTrackColor: VorColors.primAction,
        thumbColor: VorColors.primAction,
        inactiveTrackColor: VorColors.surfHigh,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: VorColors.canvas.withValues(alpha: .92),
        indicatorColor: VorColors.surfHigh,
        labelTextStyle: WidgetStatePropertyAll(VorTypography.micro(base)),
      ),
      dialogTheme: const DialogThemeData(
        backgroundColor: VorColors.surfLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
          side: BorderSide(color: VorColors.seamStrong),
        ),
      ),
    );
  }

  static OutlineInputBorder _border(Color c) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: BorderSide(color: c, width: 1),
      );
}

/// Panel (Level 1): surface #151C28 with a 1px #2A3447 seam.
class VorPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color? color;
  final VoidCallback? onTap;

  const VorPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) => Material(
        color: color ?? VorColors.surfLow,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            width: double.infinity,
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: VorColors.seam),
            ),
            child: child,
          ),
        ),
      );
}

/// Uppercase mono micro-label used across every panel header.
class VorMicroLabel extends StatelessWidget {
  final String text;
  final Color? color;
  const VorMicroLabel(this.text, {super.key, this.color});

  @override
  Widget build(BuildContext context) =>
      Text(text.toUpperCase(), style: VorTypography.micro(context).copyWith(color: color));
}

/// Status chip: 6px dot + mono descriptor with breathing pulse when active.
class VorStatusChip extends StatelessWidget {
  final String label;
  final Color color;
  final bool pulse;

  const VorStatusChip({super.key, required this.label, required this.color, this.pulse = false});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            pulse
                ? _BreathingDot(color: color)
                : Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: VorTypography.micro(context).copyWith(color: color),
              ),
            ),
          ],
        ),
      );
}

class _BreathingDot extends StatefulWidget {
  final Color color;
  const _BreathingDot({required this.color});

  @override
  State<_BreathingDot> createState() => _BreathingDotState();
}

class _BreathingDotState extends State<_BreathingDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: Tween(begin: 0.4, end: 1.0).animate(_c),
        child: Container(width: 6, height: 6, decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle)),
      );
}
