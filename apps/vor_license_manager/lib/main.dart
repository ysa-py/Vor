import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/vor_license.dart';
import 'l10n/app_localizations.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: ManagerApp()));
}

/// Admin passcode gate — the Manager is a standalone tool for the operator
/// ONLY (never distributed to customers; the client app cannot issue keys).
final unlockedProvider = StateProvider<bool>((ref) => false);

class ManagerApp extends ConsumerWidget {
  const ManagerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Vor License Manager',
      debugShowCheckedModeBanner: false,
      theme: vorManagerTheme(),
      locale: const Locale('fa'),
      supportedLocales: const [Locale('fa'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: ref.watch(unlockedProvider) ? const AdminConsole() : const _PasscodeGate(),
    );
  }
}

class _PasscodeGate extends ConsumerStatefulWidget {
  const _PasscodeGate();

  @override
  ConsumerState<_PasscodeGate> createState() => _PasscodeGateState();
}

class _PasscodeGateState extends ConsumerState<_PasscodeGate> {
  final _ctrl = TextEditingController();
  String _err = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: VorPanel(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Image.asset('assets/icon.png', width: 40, height: 40),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('VOR LICENSE AUTHORITY', style: vorTypography.headlineMd(context).copyWith(fontSize: 15)),
                      vorMicroLabel('AIR-GAPPED ADMIN TOOL — PRIVATE KEY HOST'),
                    ]),
                  ),
                ]),
                const SizedBox(height: 18),
                TextField(
                  controller: _ctrl,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'ADMIN PASSCODE'),
                ),
                if (_err.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_err, style: vorTypography.micro(context).copyWith(color: vorColors.errSoft)),
                  ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: vorColors.primDeep),
                    onPressed: () {
                      if (_ctrl.text.trim().length >= 4) {
                        ref.read(unlockedProvider.notifier).state = true;
                      } else {
                        setState(() => _err = 'حداقل ۴ نویسه / min 4 chars');
                      }
                    },
                    child: const Text('UNLOCK CONSOLE'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class AdminConsole extends ConsumerStatefulWidget {
  const AdminConsole({super.key});

  @override
  ConsumerState<AdminConsole> createState() => _AdminConsoleState();
}

class _AdminConsoleState extends ConsumerState<AdminConsole> {
  static const _kKeystore = 'vla.keystore';
  static const _kLicenses = 'vla.licenses';
  static const _kAudit = 'vla.audit';

  final _secure = const FlutterSecureStorage();
  final Future<SharedPreferences> _prefs = SharedPreferences.getInstance();
  VorKeyStore? _ks;
  List<Map<String, dynamic>> _licenses = [];
  List<Map<String, dynamic>> _audit = [];
  bool _loaded = false;

  int get _now => DateTime.now().millisecondsSinceEpoch ~/ 1000;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final ksRaw = await _secure.read(key: _kKeystore);
    if (ksRaw != null) _ks = await VorKeyStore.fromJson(jsonDecode(ksRaw));
    final prefs = await _prefs;
    _licenses = _readList(prefs, _kLicenses);
    _audit = _readList(prefs, _kAudit);
    setState(() => _loaded = true);
  }

  List<Map<String, dynamic>> _readList(SharedPreferences prefs, String key) {
    final raw = prefs.getString(key);
    if (raw == null) return [];
    return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
  }

  Future<void> _writeList(String key, List<Map<String, dynamic>> v) async {
    final prefs = await _prefs;
    await prefs.setString(key, jsonEncode(v));
  }

  Future<void> _generateKeystore() async {
    final ks = await VorKeyStore.generate(_now);
    await _secure.write(key: _kKeystore, value: jsonEncode(ks.toJson()));
    setState(() {
      _ks = ks;
      _audit = appendAudit(_audit, 'KEYGEN', ks.activeKeyId, _now);
    });
    await _writeList(_kAudit, _audit);
  }

  Future<void> _rotate({required bool retireOld}) async {
    if (_ks == null) return;
    final newId = await _ks!.rotate(_now, retireOld: retireOld);
    await _secure.write(key: _kKeystore, value: jsonEncode(_ks!.toJson()));
    setState(() => _audit = appendAudit(_audit, 'ROTATE', '$newId retireOld=$retireOld', _now));
    await _writeList(_kAudit, _audit);
  }

  Future<String?> _issue({
    required String org,
    required String tier,
    required int days,
    required int maxDevices,
    required List<String> hwids,
    required List<String> ents,
    String? metadata,
    int? notBeforeOffsetDays,
  }) async {
    if (_ks == null) return null;
    final payload = buildPayload(
      nowSecs: _now,
      days: days,
      keyId: _ks!.activeKeyId,
      tier: tier,
      entitlements: ents,
      maxDevices: maxDevices,
      boundHwids: hwids,
      metadata: metadata,
      notBefore: notBeforeOffsetDays == null ? null : _now + notBeforeOffsetDays * 86400,
    );
    final envelope = await issueLicenseEnvelope(_ks!, payload);
    final summary = {
      'license_id': payload['license_id'],
      'org': org.trim(),
      'envelope': envelope,
      'tier': tier,
      'issued_at': payload['issued_at'],
      'expires_at': payload['expires_at'],
      'max_devices': maxDevices,
      'bound_hwids': payload['device_policy']['bound_hwids'],
      'entitlements': ents,
      'revoked': false,
    };
    setState(() {
      _licenses = [..._licenses, summary];
      _audit = appendAudit(_audit, 'SIG_ISSUED', '${payload['license_id']} tier=$tier expires=${payload['expires_at']}', _now);
    });
    await _writeList(_kLicenses, _licenses);
    await _writeList(_kAudit, _audit);
    return envelope;
  }

  Future<void> _revoke(String licenseId) async {
    setState(() {
      _licenses = _licenses
          .map((l) => l['license_id'] == licenseId ? {...l, 'revoked': true} : l)
          .toList();
      _audit = appendAudit(_audit, 'REVOKE', licenseId, _now);
    });
    await _writeList(_kLicenses, _licenses);
    await _writeList(_kAudit, _audit);
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Center(child: CircularProgressIndicator());
    final chainOk = verifyAuditChain(_audit);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          toolbarHeight: 84,
          title: Row(children: [
            Image.asset('assets/icon.png', width: 34, height: 34),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('VOR LICENSE AUTHORITY', style: vorTypography.headlineMd(context).copyWith(fontSize: 15)),
                vorMicroLabel(_ks == null ? 'NO ACTIVE KEYSTORE' : 'ACTIVE KEY: ${_ks!.activeKeyId}'),
              ]),
            ),
            vorStatusChip(context, _ks == null ? 'LOCKED' : 'ED25519 READY', _ks == null ? vorColors.amberSoft : vorColors.sec),
          ]),
          actions: [
            IconButton(
              tooltip: 'Export trusted public keys (client bundle)',
              onPressed: _ks == null ? null : () => SharePlus.instance.share(ShareParams(
                    text: const JsonEncoder.withIndent('  ').convert({'trusted_version': 1, 'keys': _ks!.keys}),
                    title: 'vor_trusted_keys.json',
                  )),
              icon: const Icon(Icons.public),
            ),
            const SizedBox(width: 8),
          ],
          bottom: const TabBar(tabs: [
            Tab(text: 'ISSUE'),
            Tab(text: 'LICENSES'),
            Tab(text: 'LEDGER'),
          ]),
        ),
        body: _ks == null
            ? Center(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: vorColors.primDeep),
                  onPressed: _generateKeystore,
                  icon: const Icon(Icons.key),
                  label: const Text('GENERATE KEYSTORE'),
                ),
              )
            : TabBarView(
                children: [
                  _IssueTab(onIssue: _issue, activeKey: _ks!.activeKeyId),
                  _LicensesTab(licenses: _licenses, onRevoke: _revoke),
                  _LedgerTab(entries: _audit, chainOk: chainOk, onRotate: _rotate),
                ],
              ),
      ),
    );
  }
}

typedef IssueFn = Future<String?> Function({
  required String org,
  required String tier,
  required int days,
  required int maxDevices,
  required List<String> hwids,
  required List<String> ents,
  String? metadata,
  int? notBeforeOffsetDays,
});

class _IssueTab extends ConsumerStatefulWidget {
  final IssueFn onIssue;
  final String activeKey;
  const _IssueTab({required this.onIssue, required this.activeKey});

  @override
  ConsumerState<_IssueTab> createState() => _IssueTabState();
}

class _IssueTabState extends ConsumerState<_IssueTab> {
  final _org = TextEditingController();
  final _hwids = TextEditingController();
  final _meta = TextEditingController();
  String _tier = 'pro';
  String _days = '365';
  String _maxDevices = '3';
  List<String> _ents = ['core_tunnel', 'stealth_engine'];
  Map<String, dynamic>? _issuedEnvelope;

  @override
  Widget build(BuildContext context) {
    if (_issuedEnvelope != null) return _resultView(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              vorMicroLabel('CLIENT ORGANIZATION / ENTITY'),
              TextField(controller: _org, decoration: const InputDecoration(hintText: 'e.g. Apex Cyber Command')),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _tier,
                    decoration: const InputDecoration(labelText: 'TIER'),
                    items: kTiers.map((t) => DropdownMenuItem(value: t, child: Text(t.toUpperCase()))).toList(),
                    onChanged: (v) => setState(() => _tier = v ?? _tier),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: TextEditingController(text: _days),
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'DAYS (neg = expired)'),
                    onChanged: (v) => _days = v,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: TextEditingController(text: _maxDevices),
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'MAX DEVICES'),
                    onChanged: (v) => _maxDevices = v,
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              vorMicroLabel('BOUND HWIDS (one per line — empty = unbound)'),
              TextField(
                controller: _hwids,
                maxLines: 3,
                style: vorTypography.micro(context),
                decoration: const InputDecoration(hintText: 'HWID-SHA256-…'),
              ),
              const SizedBox(height: 10),
              vorMicroLabel('ENTITLEMENTS'),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: kEntitlements.map((e) {
                  final on = _ents.contains(e);
                  return FilterChip(
                    label: Text(e.toUpperCase(), style: vorTypography.micro(context)),
                    selected: on,
                    onSelected: (v) => setState(() => _ents = v ? [..._ents, e] : _ents.where((x) => x != e).toList()),
                    selectedColor: vorColors.primDeep,
                    side: const BorderSide(color: vorColors.seam),
                  );
                }).toList(),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _meta,
                decoration: const InputDecoration(labelText: 'METADATA / ORDER REF (optional)'),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: vorColors.primDeep),
                  onPressed: () async {
                    final days = int.tryParse(_days) ?? 365;
                    final envelope = await widget.onIssue(
                      org: _org.text,
                      tier: _tier,
                      days: days,
                      maxDevices: int.tryParse(_maxDevices) ?? 1,
                      hwids: _hwids.text.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
                      ents: _ents,
                      metadata: _meta.text,
                      notBeforeOffsetDays: days < 0 ? days : null,
                    );
                    if (envelope != null) {
                      setState(() => _issuedEnvelope = {'envelope': envelope});
                    }
                  },
                  icon: const Icon(Icons.verified_user),
                  label: const Text('SIGN & ISSUE (ED25519)'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _resultView(BuildContext context) {
    final env = _issuedEnvelope!['envelope'] as String;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              vorMicroLabel('SIGNED ENVELOPE — COPY OR SHARE .VORLIC', color: vorColors.sec),
              const SizedBox(height: 8),
              SelectableText(env, style: vorTypography.micro(context)),
              const SizedBox(height: 12),
              Row(children: [
                FilledButton(
                  onPressed: () => SharePlus.instance.share(ShareParams(
                    text: const JsonEncoder.withIndent('  ').convert(licenseFileDoc(env)),
                    title: 'VOR-${env.hashCode}.vorlic',
                  )),
                  child: const Text('SHARE .VORLIC'),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: vorMicroLabel('QR TRANSFER (OFFLINE)'),
                      content: SizedBox(
                        width: 240,
                        height: 240,
                        child: QrImageView(data: env, backgroundColor: vorColors.canvas),
                      ),
                      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('CLOSE'))],
                    ),
                  ),
                  child: const Text('QR'),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => setState(() => _issuedEnvelope = null),
                  child: const Text('ISSUE ANOTHER'),
                ),
              ]),
            ],
          ),
        ),
      ],
    );
  }
}

class _LicensesTab extends StatelessWidget {
  final List<Map<String, dynamic>> licenses;
  final Future<void> Function(String) onRevoke;
  const _LicensesTab({required this.licenses, required this.onRevoke});

  @override
  Widget build(BuildContext context) {
    if (licenses.isEmpty) return const Center(child: Text('NO LICENSES ISSUED YET'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: licenses.length,
      itemBuilder: (_, i) {
        final l = licenses[i];
        final revoked = l['revoked'] == true;
        final daysLeft = ((l['expires_at'] as int) - DateTime.now().millisecondsSinceEpoch ~/ 1000) ~/ 86400;
        return VorPanel(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            leading: Icon(
              revoked ? Icons.block : Icons.verified,
              color: revoked ? vorColors.crimson : vorColors.sec,
            ),
            title: Text('${l['org']} — ${(l['tier'] as String).toUpperCase()}',
                style: vorTypography.labelMd(context)),
            subtitle: Text(
              '${(l['license_id'] as String).substring(0, 8)}… • ${daysLeft}d left • ${l['entitlements'].length} ents',
              style: vorTypography.micro(context),
            ),
            trailing: revoked
                ? vorMicroLabel('REVOKED', color: vorColors.crimson)
                : IconButton(
                    icon: const Icon(Icons.gpp_bad, size: 18, color: vorColors.crimson),
                    tooltip: 'Locally revoke',
                    onPressed: () => onRevoke(l['license_id'] as String),
                  ),
          ),
        );
      },
    );
  }
}

class _LedgerTab extends ConsumerWidget {
  final List<Map<String, dynamic>> entries;
  final bool chainOk;
  final Future<void> Function({required bool retireOld}) onRotate;
  const _LedgerTab({required this.entries, required this.chainOk, required this.onRotate});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        VorPanel(
          child: Row(children: [
            Icon(chainOk ? Icons.verified_user : Icons.gpp_bad, color: chainOk ? vorColors.sec : vorColors.crimson, size: 18),
            const SizedBox(width: 8),
            Expanded(child: vorMicroLabel(chainOk ? 'AUDIT CHAIN INTACT (${entries.length})' : 'CHAIN BROKEN — TAMPERING DETECTED', color: chainOk ? vorColors.sec : vorColors.crimson)),
            TextButton(
              onPressed: () => onRotate(retireOld: false),
              child: vorMicroLabel('ROTATE (SOFT)', color: vorColors.primAction),
            ),
            TextButton(
              onPressed: () => onRotate(retireOld: true),
              child: vorMicroLabel('ROTATE (HARD)', color: vorColors.crimson),
            ),
          ]),
        ),
        const SizedBox(height: 8),
        ...entries.reversed.map((e) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Text(
                '${DateTime.fromMillisecondsSinceEpoch((e['ts'] as int) * 1000).toIso8601String()} [${e['action']}] ${e['detail']}',
                style: vorTypography.micro(context).copyWith(color: vorColors.muted),
              ),
            )),
      ],
    );
  }
}
