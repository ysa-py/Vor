import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/license_controller.dart';
import 'core/vpn_engine.dart';
import 'l10n/app_localizations.dart';
import 'ui/gate/license_gate_screen.dart';
import 'ui/shell/home_shell.dart';
import 'ui/theme.dart';

/// Providers (Riverpod) — single source of truth for app-wide state.
final licenseProvider = ChangeNotifierProvider<LicenseController>((ref) => LicenseController());
final engineProvider = ChangeNotifierProvider<VorEngine>((ref) {
  final e = VorEngine();
  e.startTicker();
  return e;
});

/// true = License Gate is on screen (fail-closed until activation).
final gateRouteProvider = StateProvider<bool>((ref) => true);

class VorApp extends ConsumerStatefulWidget {
  const VorApp({super.key});

  @override
  ConsumerState<VorApp> createState() => _VorAppState();
}

class _VorAppState extends ConsumerState<VorApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final lic = ref.read(licenseProvider);
      await lic.loadRevocationList();
      final ok = await lic.restoreSession();
      ref.read(gateRouteProvider.notifier).state = !ok;
      if (ok) {
        final engine = ref.read(engineProvider);
        engine.runner = platformRunner();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VOR Secure Tunnel',
      debugShowCheckedModeBanner: false,
      theme: VorTheme.dark(),
      locale: const Locale('fa'),
      supportedLocales: const [Locale('fa'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl, // fa default; en builds flip via l10n
        child: child!,
      ),
      home: AnimatedSwitcher(
        duration: const Duration(milliseconds: 420),
        child: ref.watch(gateRouteProvider)
            ? const LicenseGateScreen(key: ValueKey('gate'))
            : const HomeShell(key: ValueKey('home')),
      ),
    );
  }
}
