import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'dart:convert';
import 'dart:math' as math;

import '../../app.dart';
import '../../core/vor_ffi.dart';
import '../../l10n/app_localizations.dart';
import '../theme.dart';

/// View B-3 — Neural Defense Matrix: REAL DPI model inference through the
/// Rust core (same weights as tools/train_dpi_model.py), countermeasure plan.
class DefenseScreen extends ConsumerStatefulWidget {
  const DefenseScreen({super.key});

  @override
  ConsumerState<DefenseScreen> createState() => _DefenseScreenState();
}

class _DefenseScreenState extends ConsumerState<DefenseScreen> {
  Map<String, dynamic>? _model;
  Map<String, dynamic> _features = const {
    'rtt_variance': 0.15, 'rst_rate': 0.05, 'handshake_fail_ratio': 0.08,
    'reset_after_client_hello': 0.05, 'payload_entropy': 0.88,
    'timing_regularity': 0.12, 'throttle_ratio': 0.08, 'probe_hit_rate': 0.03,
  };
  Map<String, dynamic>? _verdict;

  static const _scenarioTargets = {
    'calm': null,
    'throttling': [0.45, 0.20, 0.25, 0.15, 0.55, 0.75, 0.70, 0.10],
    'active_dpi': [0.70, 0.65, 0.60, 0.70, 0.25, 0.45, 0.30, 0.65],
    'blackout': [0.80, 0.70, 0.65, 0.75, 0.20, 0.50, 0.35, 0.70],
  };
  String _scenario = 'calm';

  static const _featureKeys = [
    'rtt_variance', 'rst_rate', 'handshake_fail_ratio', 'reset_after_client_hello',
    'payload_entropy', 'timing_regularity', 'throttle_ratio', 'probe_hit_rate',
  ];

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadModel);
  }

  Future<void> _loadModel() async {
    try {
      final raw = await rootBundle.loadString('assets/model/model_manifest.json');
      setState(() => _model = jsonDecode(raw) as Map<String, dynamic>);
      await _classify();
    } catch (e) {
      setState(() => _model = {'version': 'unavailable', 'error': '$e'});
    }
  }

  Future<void> _classify() async {
    try {
      final v = await compute(_classifyIsolate, {
        'features': _features,
        'model': _model,
      });
      setState(() => _verdict = v);
    } catch (_) {
      setState(() => _verdict = null);
    }
  }

  void _applyScenario(String s) {
    setState(() => _scenario = s);
    final t = _scenarioTargets[s];
    if (t != null) {
      _features = Map.fromIterators(_featureKeys.iterator, t.iterator);
    } else {
      _features = const {
        'rtt_variance': 0.15, 'rst_rate': 0.05, 'handshake_fail_ratio': 0.08,
        'reset_after_client_hello': 0.05, 'payload_entropy': 0.88,
        'timing_regularity': 0.12, 'throttle_ratio': 0.08, 'probe_hit_rate': 0.03,
      };
    }
    _classify();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final cls = _verdict?['class'] as String? ?? '—';
    final conf = ((_verdict?['confidence'] as num?) ?? 0) * 100;
    final probs = (_verdict?['probs'] as List?)?.cast<num>() ?? const [];
    final classColor = switch (cls) {
      'benign' => VorColors.sec,
      'throttling' => VorColors.amberSoft,
      'active_dpi' => VorColors.crimson,
      _ => VorColors.muted,
    };

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        VorPanel(
          child: Row(
            children: [
              Icon(Icons.psychology, color: classColor, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.defenseTitle, style: VorTypography.headlineMd(context).copyWith(fontSize: 16)),
                    VorMicroLabel('MODEL ${_model?['version'] ?? '…'} • VAL_ACC ${((_model?['val_accuracy'] as num?) ?? 0 * 100).toStringAsFixed(0)}%'),
                  ],
                ),
              ),
              VorStatusChip(label: cls.toUpperCase(), color: classColor, pulse: cls != '—'),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.scenarios),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final s in _scenarioTargets.keys)
                    ChoiceChip(
                      label: Text(s.toUpperCase(), style: VorTypography.micro(context)),
                      selected: _scenario == s,
                      onSelected: (_) => _applyScenario(s),
                      selectedColor: VorColors.primDeep,
                      backgroundColor: VorColors.surf,
                      side: const BorderSide(color: VorColors.seam),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel(l.dpiClass),
              const SizedBox(height: 10),
              for (var i = 0; i < 3; i++)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 92,
                        child: Text(
                          ['BENIGN', 'THROTTLING', 'ACTIVE_DPI'][i],
                          style: VorTypography.labelSm(context),
                        ),
                      ),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: LinearProgressIndicator(
                            value: probs.length > i ? probs[i].toDouble() : 0,
                            minHeight: 7,
                            backgroundColor: VorColors.surfHigh,
                            color: [VorColors.sec, VorColors.amberSoft, VorColors.crimson][i],
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 46,
                        child: Text(
                          '${probs.length > i ? (probs[i] * 100).toStringAsFixed(1) : '0.0'}%',
                          textAlign: TextAlign.right,
                          style: VorTypography.labelSm(context),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerLeft,
                child: VorMicroLabel('${l.confidence}: ${conf.toStringAsFixed(1)}%', color: classColor),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VorPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VorMicroLabel('LIVE FEATURES'),
              const SizedBox(height: 8),
              ...List.generate(_featureKeys.length, (i) {
                final v = (_features[_featureKeys[i]] as num?)?.toDouble() ?? 0;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 150,
                        child: Text(_featureKeys[i],
                            style: VorTypography.micro(context).copyWith(color: VorColors.muted)),
                      ),
                      Expanded(
                        child: Slider(
                          value: v,
                          onChanged: (nv) {
                            setState(() => _features = {..._features, _featureKeys[i]: nv});
                          },
                          onChangeEnd: (_) => _classify(),
                        ),
                      ),
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
}

/// Isolate wrapper so inference never janks the UI thread.
Map<String, dynamic> _classifyIsolate(Map<String, dynamic> args) {
  final model = args['model'] as Map<String, dynamic>?;
  if (model == null) return {};
  final f = (args['features'] as Map).cast<String, num>();
  List<double> vec(Map<String, dynamic> w) => w.values.expand((r) => (r as List).cast<num>()).map((e) => e.toDouble()).toList();
  // Direct 8→16→8→3 forward pass with the manifest weights.
  double dot(List<double> a, List<double> b, double bias) {
    var s = bias;
    for (var i = 0; i < a.length; i++) {
      s += a[i] * b[i];
    }
    return s;
  }

  List<double> matMul(List<List<double>> w, List<double> x, List<double> b, {bool relu = false}) {
    final out = List<double>.generate(w.length, (i) => dot(w[i], x, b[i]));
    return relu ? out.map((v) => v > 0 ? v : 0.0).toList() : out;
  }

  List<List<double>> shape(List<dynamic> rows) =>
      rows.map((r) => (r as List).cast<num>().map((e) => e.toDouble()).toList()).toList();

  final x = _featureKeys.map((k) => (f[k] ?? 0).toDouble().clamp(0, 1).toDouble()).toList();
  final h1 = matMul(shape(model['weights']['W1']), x, (model['weights']['b1'] as List).cast<num>().map((e) => e.toDouble()).toList(), relu: true);
  final h2 = matMul(shape(model['weights']['W2']), h1, (model['weights']['b2'] as List).cast<num>().map((e) => e.toDouble()).toList(), relu: true);
  final logits = matMul(shape(model['weights']['W3']), h2, (model['weights']['b3'] as List).cast<num>().map((e) => e.toDouble()).toList());
  final mx = logits.reduce((a, b) => a > b ? a : b);
  final exps = logits.map((l) => math.exp(l - mx)).toList();
  final sum = exps.fold(0.0, (a, b) => a + b);
  final probs = exps.map((e) => e / sum).toList();
  var best = 0;
  for (var i = 1; i < 3; i++) {
    if (probs[i] > probs[best]) best = i;
  }
  return {
    'class': ['benign', 'throttling', 'active_dpi'][best],
    'confidence': probs[best],
    'probs': probs,
  };
}
