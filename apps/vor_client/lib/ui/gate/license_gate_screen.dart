import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../core/vor_ffi.dart' as vor_core;
import '../../l10n/app_localizations.dart';
import '../theme.dart';

/// View A — the mandatory first screen. Fail-closed: no valid license, no app.
class LicenseGateScreen extends ConsumerStatefulWidget {
  const LicenseGateScreen({super.key});

  @override
  ConsumerState<LicenseGateScreen> createState() => _LicenseGateScreenState();
}

class _LicenseGateScreenState extends ConsumerState<LicenseGateScreen> {
  final _input = TextEditingController();
  String? _hwid;
  String? _error;
  String? _errorCode;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      try {
        setState(() => _hwid = vor_core.VorCore.I.hwid);
      } catch (_) {
        setState(() => _hwid = 'HWID-UNAVAILABLE (core not linked)');
      }
    });
  }

  Future<void> _activate() async {
    setState(() {
      _busy = true;
      _error = null;
      _errorCode = null;
    });
    final report = await ref.read(licenseProvider).activate(_input.text);
    if (!mounted) return;
    if (report.ok) {
      ref.read(engineProvider).runner = platformRunner();
      ref.read(gateRouteProvider.notifier).state = false;
    } else {
      setState(() {
        _errorCode = report.errorCode;
        _error = report.error;
        _busy = false;
      });
    }
  }

  Future<void> _pickFile() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      extensions: ['vorlic', 'json', 'txt'],
    );
    final path = res?.files.single.path;
    if (path == null) return;
    final text = await File(path).readAsString();
    try {
      final doc = jsonDecode(text) as Map<String, dynamic>;
      _input.text = (doc['envelope'] as String?) ?? text.trim();
    } catch (_) {
      _input.text = text.trim(); // raw envelope paste
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 430),
            child: ListView(
              padding: const EdgeInsets.all(16),
              shrinkWrap: true,
              children: [
                Row(
                  children: [
                    Image.asset('assets/icon.png', width: 44, height: 44),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l.brand, style: VorTypography.headlineMd(context)),
                          VorMicroLabel('ED25519 • OFFLINE • FAIL-CLOSED'),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                VorPanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      VorMicroLabel(l.gateTitle),
                      const SizedBox(height: 6),
                      Text(l.gateSubtitle, style: VorTypography.bodyMd(context).copyWith(color: VorColors.muted)),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                VorPanel(
                  child: Row(
                    children: [
                      const Icon(Icons.fingerprint, color: VorColors.primAction, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            VorMicroLabel(l.hwid),
                            SelectableText(
                              _hwid ?? '…',
                              style: VorTypography.labelSm(context).copyWith(color: VorColors.sec),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () {
                          if (_hwid != null) Clipboard.setData(ClipboardData(text: _hwid!));
                        },
                        icon: const Icon(Icons.copy, size: 16, color: VorColors.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _input,
                  maxLines: 4,
                  style: VorTypography.labelSm(context).copyWith(color: VorColors.ink),
                  decoration: InputDecoration(hintText: l.licenseHint),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _pickFile,
                        icon: const Icon(Icons.file_open, size: 16),
                        label: Text(l.pickFile, style: VorTypography.labelMd(context)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: () async {
                        final data = await Clipboard.getData('text/plain');
                        if (data?.text != null) _input.text = data!.text!;
                        setState(() {});
                      },
                      child: Text(l.paste, style: VorTypography.labelMd(context)),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: VorColors.crimson.withValues(alpha: .1),
                      border: Border.all(color: VorColors.crimson),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const Icon(Icons.gpp_bad, color: VorColors.errSoft, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(l.errGate,
                                style: VorTypography.labelMd(context).copyWith(color: VorColors.errSoft)),
                          ),
                        ]),
                        const SizedBox(height: 4),
                        Text('$_errorCode', style: VorTypography.micro(context).copyWith(color: VorColors.errSoft)),
                        const SizedBox(height: 2),
                        Text(_localizedError(l, _errorCode!) ?? _error!,
                            style: VorTypography.bodyMd(context).copyWith(color: VorColors.errSoft)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  height: 46,
                  child: FilledButton(
                    onPressed: (_busy || _input.text.trim().length < 24) ? null : _activate,
                    style: FilledButton.styleFrom(backgroundColor: VorColors.primDeep),
                    child: _busy
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(l.activate, style: VorTypography.labelMd(context).copyWith(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(height: 12),
                Center(child: VorMicroLabel('0 TELEMETRY PACKETS TRANSMITTED — AIR-GAPPED NODE')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String? _localizedError(AppLocalizations l, String code) => switch (code) {
      'E_SIGNATURE' => l.errE_SIGNATURE,
      'E_EXPIRED' => l.errE_EXPIRED,
      'E_DEVICE' => l.errE_DEVICE,
      'E_UNTRUSTED_KEY' => l.errE_UNTRUSTED_KEY,
      'E_MALFORMED' => l.errE_MALFORMED,
      'E_REVOKED' => l.errE_REVOKED,
      _ => null,
    };
