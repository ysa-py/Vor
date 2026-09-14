import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../app.dart';
import '../../core/vor_ffi.dart';
import '../../l10n/app_localizations.dart';
import '../theme.dart';

/// View B-5 — Kernel config: protocol engine, MTU clamp, congestion control,
/// DNS strategy, kill switch, config import (share links/subscriptions) and
/// fully-local QR export.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _importCtrl = TextEditingController();
  String _protocol = 'xtls_reality';
  double _mtu = 1420;
  String _congestion = 'bbr';
  String _dnsMode = 'doh';
  bool _killSwitch = true;
  bool _portHopping = false;
  List<Map<String, dynamic>> _parsed = [];
  List<String> _errors = [];
  Map<String, dynamic>? _qrProfile;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final lic = ref.watch(licenseProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Protocol engine.
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.protocol),
              const SizedBox(height: 8),
              ...[
                ('wireguard', 'WireGuard-ChaCha20-Poly1305', 'Hardware kernel accelerated'),
                ('xtls_reality', 'XTLS-Reality (Vision)', 'SNI impersonation • uTLS fingerprint'),
                ('vless_ws_cdn', 'VLESS-WS-TLS-CDN', 'Blackout-resilient CDN routing'),
                ('ss2022', 'Shadowsocks-2022 (AEAD)', 'BLAKE3 keyed • UDP morphing'),
              ].map((p) => RadioListTile<String>(
                    value: p.$1,
                    groupValue: _protocol,
                    onChanged: (v) => setState(() => _protocol = v!),
                    title: Text(p.$2, style: VorTypography.labelMd(context)),
                    subtitle: Text(p.$3, style: VorTypography.micro(context).copyWith(color: VorColors.faint)),
                    dense: true,
                    activeColor: VorColors.primAction,
                    contentPadding: EdgeInsets.zero,
                  )),
            ],
          ),
        ),
        const SizedBox(height: 10),
        // MTU + congestion + DNS.
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  VorMicroLabel('${l.mtu}: ${_mtu.round()} B'),
                  const Spacer(),
                  VorMicroLabel('CONGESTION: $_congestion', color: VorColors.primAction),
                ],
              ),
              Slider(
                value: _mtu,
                min: 1280,
                max: 1500,
                divisions: 22,
                onChanged: (v) => setState(() => _mtu = v),
              ),
              Wrap(
                spacing: 6,
                children: [
                  for (final c in ['bbr', 'cubic', 'westwood'])
                    ChoiceChip(
                      label: Text(c.toUpperCase(), style: VorTypography.micro(context)),
                      selected: _congestion == c,
                      onSelected: (_) => setState(() => _congestion = c),
                      selectedColor: VorColors.primDeep,
                      side: const BorderSide(color: VorColors.seam),
                    ),
                ],
              ),
              const Divider(height: 20),
              VorMicroLabel(l.dnsMode),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final d in [('doh', 'DoH'), ('dot', 'DoT'), ('domestic', 'DOMESTIC-DIRECT'), ('bootstrap', 'BOOTSTRAP-IPs')])
                    ChoiceChip(
                      label: Text(d.$2, style: VorTypography.micro(context)),
                      selected: _dnsMode == d.$1,
                      onSelected: (_) => setState(() => _dnsMode = d.$1),
                      selectedColor: VorColors.primDeep,
                      side: const BorderSide(color: VorColors.seam),
                    ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.killSwitch, style: VorTypography.labelMd(context)),
                value: _killSwitch,
                onChanged: (v) => setState(() => _killSwitch = v),
                activeColor: VorColors.sec,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('PORT HOPPING (10000-20000 / 45s)', style: VorTypography.labelMd(context)),
                value: _portHopping,
                onChanged: (v) => setState(() => _portHopping = v),
                activeColor: VorColors.sec,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        // Import + QR.
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.importConfig),
              const SizedBox(height: 8),
              TextField(
                controller: _importCtrl,
                maxLines: 3,
                style: VorTypography.labelSm(context),
                decoration: const InputDecoration(
                  hintText: 'vless:// … vmess:// … trojan:// … ss://  (or base64 subscription)',
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: VorColors.primDeep),
                    onPressed: _runImport,
                    child: Text('PARSE', style: VorTypography.labelMd(context)),
                  ),
                  const SizedBox(width: 8),
                  if (_qrProfile != null)
                    OutlinedButton(
                      onPressed: () => _showQr(context),
                      child: Text(l.qrExport, style: VorTypography.labelMd(context)),
                    ),
                ],
              ),
              if (_parsed.isNotEmpty) ...[
                const SizedBox(height: 8),
                ..._parsed.map((p) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle, size: 14, color: VorColors.sec),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '${p['protocol']} → ${(p['endpoint']?['address'] ?? '')}',
                              style: VorTypography.labelSm(context),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          TextButton(
                            onPressed: () => setState(() => _qrProfile = p),
                            child: VorMicroLabel('QR', color: VorColors.primAction),
                          ),
                        ],
                      ),
                    )),
              ],
              if (_errors.isNotEmpty) ...[
                const SizedBox(height: 6),
                ..._errors.map((e) => Text(
                      '✗ $e',
                      style: VorTypography.micro(context).copyWith(color: VorColors.errSoft),
                    )),
              ],
            ],
          ),
        ),
        const SizedBox(height: 10),
        // License zone.
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.license),
              const SizedBox(height: 6),
              Text(
                '${lic.lastReport?.licenseId ?? "—"} • ${lic.lastReport?.tier?.toUpperCase() ?? "—"} • ${lic.lastReport?.daysRemaining ?? "?"}d',
                style: VorTypography.labelMd(context),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: VorColors.errSoft, side: const BorderSide(color: VorColors.crimson)),
                onPressed: () async {
                  await ref.read(licenseProvider).deactivate();
                  ref.read(gateRouteProvider.notifier).state = true;
                },
                icon: const Icon(Icons.logout, size: 16),
                label: Text(l.deactivate, style: VorTypography.labelMd(context)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _runImport() {
    final resp = VorCore.I.parseSubscription(_importCtrl.text);
    final profiles = (resp['profiles'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final errors = (resp['errors'] as List?)?.map((e) => e.toString()).toList() ?? [];
    setState(() {
      _parsed = profiles;
      _errors = errors;
      _qrProfile = profiles.isEmpty ? null : profiles.first;
    });
  }

  void _showQr(BuildContext context) {
    final raw = _qrProfile?['raw'] as String? ?? '';
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: VorMicroLabel(l.qrExport),
        content: SizedBox(
          width: 240,
          height: 240,
          child: QrImageView(
            data: raw,
            backgroundColor: VorColors.canvas,
            eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: VorColors.ink),
            dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: VorColors.ink),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: VorMicroLabel('CLOSE', color: VorColors.muted),
          ),
        ],
      ),
    );
  }
}
