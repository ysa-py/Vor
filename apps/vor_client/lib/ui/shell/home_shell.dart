import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../l10n/app_localizations.dart';
import '../analytics/analytics_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../defense/defense_screen.dart';
import '../diagnostics/diagnostics_screen.dart';
import '../settings/settings_screen.dart';
import '../theme.dart';

/// View B — main client shell: bottom navigation (mobile) with the five tabs.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;

  static const _tabs = [
    DashboardScreen(),
    AnalyticsScreen(),
    DefenseScreen(),
    DiagnosticsScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: _VorAppBar(l: l),
      body: IndexedStack(index: _tab, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        height: 62,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.shield_outlined), selectedIcon: const Icon(Icons.shield), label: l.navTunnel),
          NavigationDestination(icon: const Icon(Icons.query_stats_outlined), selectedIcon: const Icon(Icons.query_stats), label: l.navAnalytics),
          NavigationDestination(icon: const Icon(Icons.psychology_outlined), selectedIcon: const Icon(Icons.psychology), label: l.navDefense),
          NavigationDestination(icon: const Icon(Icons.terminal_outlined), selectedIcon: const Icon(Icons.terminal), label: l.navDiagnostics),
          NavigationDestination(icon: const Icon(Icons.tune_outlined), selectedIcon: const Icon(Icons.tune), label: l.navSettings),
        ],
      ),
    );
  }
}

class _VorAppBar extends ConsumerWidget implements PreferredSizeWidget {
  final AppLocalizations l;
  const _VorAppBar({required this.l});

  @override
  Size get preferredSize => const Size.fromHeight(76);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final engine = ref.watch(engineProvider);
    final lic = ref.watch(licenseProvider);
    final connected = engine.state == TunnelState.connected;
    return AppBar(
      backgroundColor: VorColors.canvas.withValues(alpha: .92),
      surfaceTintColor: Colors.transparent,
      toolbarHeight: 76,
      title: Row(
        children: [
          Image.asset('assets/icon.png', width: 34, height: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.brand, style: VorTypography.headlineMd(context).copyWith(fontSize: 16)),
                VorMicroLabel(connected ? 'TUNNEL • CHACHA20-POLY1305' : 'SECURE ENCLAVE'),
              ],
            ),
          ),
          VorStatusChip(
            label: lic.activated ? 'ED25519 VERIFIED' : 'LICENSE REQUIRED',
            color: lic.activated ? VorColors.sec : VorColors.amberSoft,
            pulse: lic.activated,
          ),
        ],
      ),
    );
  }
}
