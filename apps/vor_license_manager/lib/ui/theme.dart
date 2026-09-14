import 'package:flutter/material.dart';

/// Manager design system — same tactical tokens as the client.
abstract final class vorColors {
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
  static const primAction = Color(0xFF3B82F6);
  static const primDeep = Color(0xFF2563EB);
  static const sec = Color(0xFF4EDEA3);
  static const amberSoft = Color(0xFFFFB95F);
  static const crimson = Color(0xFFEF4444);
  static const errSoft = Color(0xFFFFB4AB);
}

abstract final class vorTypography {
  static TextStyle micro(BuildContext c) => const TextStyle(
        fontFamily: 'monospace',
        fontSize: 10,
        letterSpacing: 0.8,
        fontWeight: FontWeight.w600,
        color: vorColors.muted,
      );
  static TextStyle labelMd(BuildContext c) => const TextStyle(
        fontFamily: 'monospace',
        fontSize: 13,
        color: vorColors.ink,
      );
  static TextStyle headlineMd(BuildContext c) => const TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.1,
        color: vorColors.ink,
      );
}

ThemeData vorManagerTheme() => ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: vorColors.canvas,
      colorScheme: const ColorScheme.dark(
        surface: vorColors.canvas,
        primary: vorColors.primAction,
        onPrimary: Colors.white,
        secondary: vorColors.sec,
        onSecondary: Color(0xFF003824),
        error: vorColors.crimson,
        onSurface: vorColors.ink,
        onSurfaceVariant: vorColors.muted,
        outline: vorColors.seam,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: vorColors.surfLowest,
        constraints: const BoxConstraints(minHeight: 38),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: vorColors.seam),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: vorColors.seam),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: vorColors.primAction),
        ),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: vorColors.ink,
        unselectedLabelColor: vorColors.faint,
        indicatorColor: vorColors.sec,
      ),
    );

Widget vorMicroLabel(String text, {Color? color}) => Text(
      text.toUpperCase(),
      style: TextStyle(
        fontFamily: 'monospace',
        fontSize: 10,
        letterSpacing: 0.8,
        fontWeight: FontWeight.w600,
        color: color ?? vorColors.muted,
      ),
    );

Widget vorStatusChip(BuildContext context, String label, Color color) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label.toUpperCase(),
          style: vorTypography.micro(context).copyWith(color: color)),
    );

class VorPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets? margin;

  const VorPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
    this.margin,
  });

  @override
  Widget build(BuildContext context) => Container(
        margin: margin,
        padding: padding,
        decoration: BoxDecoration(
          color: vorColors.surfLow,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: vorColors.seam),
        ),
        child: child,
      );
}
