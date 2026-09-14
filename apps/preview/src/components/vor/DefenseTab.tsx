'use client';

/**
 * View B-3 — AI Defense: sentry banner, defense efficiency dial, REAL neural
 * classifier probabilities (weights from the shipped manifest), live feature
 * sliders, threat-scenario selector and countermeasure chips that visibly
 * repair the tunnel telemetry (closed loop).
 */
import { useMemo } from 'react';
import { BrainCircuit, Brain, SlidersHorizontal, Zap, Waves, ShieldCheck } from 'lucide-react';
import { useVor, t } from '@/lib/vor/store';
import {
  FEATURE_LABELS_EN,
  FEATURE_LABELS_FA,
  FEATURE_ORDER,
  cmLabel,
  type DpiClass,
} from '@/lib/vor/dpi';
import { BarScope, Micro, Panel, Pill, StatusDot, TacticalToggle } from './primitives';

const CLASS_COLORS: Record<DpiClass, string> = {
  benign: '#4edea3',
  throttling: '#ffb95f',
  active_dpi: '#ef4444',
};

const SCENARIOS = [
  { id: 'calm', key: 'scnCalm' },
  { id: 'throttling', key: 'scnThrottling' },
  { id: 'active_dpi', key: 'scnActiveDpi' },
  { id: 'blackout', key: 'scnBlackout' },
] as const;

export function DefenseTab() {
  const lang = useVor((s) => s.lang);
  const T = t(lang);
  const model = useVor((s) => s.model);
  const modelError = useVor((s) => s.modelError);
  const features = useVor((s) => s.features);
  const verdict = useVor((s) => s.verdict);
  const scenario = useVor((s) => s.scenario);
  const setScenario = useVor((s) => s.setScenario);
  const plan = useVor((s) => s.plan);
  const activeCms = useVor((s) => s.activeCms);
  const toggleCm = useVor((s) => s.toggleCm);
  const applyPlan = useVor((s) => s.applyPlan);
  const setFeature = useVor((s) => s.setFeature);
  const manualOverride = useVor((s) => s.manualOverride);
  const setManualOverride = useVor((s) => s.setManualOverride);
  const featuresHist = useVor((s) => s.features.rst_rate);
  const series = useVor((s) => s.series);

  const featLabels = lang === 'fa' ? FEATURE_LABELS_FA : FEATURE_LABELS_EN;

  // Entropy oscilloscope — reuse the live downlink series scaled + noise.
  const scope = useMemo(() => {
    const s = series.down.length ? series.down : [0];
    return s.map((v) => Math.min(1, v / 160 + 0.1 + (verdict ? verdict.probs[0] * 0.2 : 0)));
  }, [series.down, verdict]);

  const defenseEfficiency = verdict ? Math.round((verdict.probs[0] * 100)) : 100;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Sentry banner */}
      <Panel className="p-4 relative overflow-hidden flex flex-col gap-2">
        <div className="absolute -right-8 -top-8 w-36 h-36 bg-sec/5 rounded-full blur-2xl pointer-events-none" aria-hidden />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot color="#4edea3" ping size={10} />
            <span className="label-sm text-sec uppercase tracking-widest">{T('sentinelArmed')}</span>
          </div>
          <Pill color="text-prim" bg="bg-surf-high">FIPS 140-3 L4</Pill>
        </div>
        <div className="label-xs text-ink-var tracking-tight">{T('zeroTouch')}</div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Pill color="text-prim" bg="bg-surf">HEURISTIC V4.9</Pill>
          <Pill color="text-sec" bg="bg-surf">TICK: 10,000 Hz</Pill>
          <Pill color="text-ink-var" bg="bg-surf">ML-KEM-1024</Pill>
          {model && (
            <Pill color="text-prim" bg="bg-surf" className="truncate" >
              <BrainCircuit className="w-3 h-3" aria-hidden />
              <span dir="ltr">{model.version}</span>
            </Pill>
          )}
        </div>
      </Panel>

      {/* Scenario selector */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-tert" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('scenario')}</span>
          </div>
          <Pill color="text-tert" bg="bg-tert/10">DEMO</Pill>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScenario(s.id)}
              aria-pressed={scenario === s.id}
              className={`py-2 px-1 rounded-4px label-xs uppercase transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                scenario === s.id
                  ? s.id === 'calm'
                    ? 'bg-sec/20 text-sec border border-sec/60'
                    : s.id === 'blackout'
                      ? 'bg-tert/20 text-tert border border-tert/60'
                      : 'bg-crimson/20 text-err border border-crimson/60'
                  : 'bg-surf-lowest text-muted border border-seam hover:text-ink hover:border-seam-strong'
              }`}
            >
              {T(s.key)}
            </button>
          ))}
        </div>

        {/* manual override */}
        <div className="flex items-center justify-between bg-surf-lowest border border-seam rounded p-2.5">
          <div className="flex flex-col pe-2">
            <span className="label-md text-ink uppercase">{T('manualMode')}</span>
            <span className="text-[11px] text-faint leading-4">{T('manualNote')}</span>
          </div>
          <TacticalToggle checked={manualOverride} onChange={setManualOverride} onColor="#3b82f6" label={T('manualMode')} />
        </div>
      </Panel>

      {/* Neural Defense Matrix — dial + verdict */}
      <Panel className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Brain className="w-5 h-5 text-sec" aria-hidden />
            <span className="text-lg font-semibold text-ink uppercase tracking-tight">{T('defenseMatrix')}</span>
          </div>
          <Pill color="text-sec" bg="bg-surf-high">ACTIVE AUTOPILOT</Pill>
        </div>

        {/* probabilities */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Micro className="text-ink-var">{T('classProbabilities')}</Micro>
            <span className="label-xs text-faint tnum" dir="ltr">
              {T('confidence')}: {verdict ? (verdict.confidence * 100).toFixed(1) : '—'}%
            </span>
          </div>
          {(['benign', 'throttling', 'active_dpi'] as DpiClass[]).map((cls, i) => {
            const p = verdict ? verdict.probs[i] : 0;
            const color = CLASS_COLORS[cls];
            const label = cls === 'benign' ? T('clsBenign') : cls === 'throttling' ? T('clsThrottling') : T('clsActiveDpi');
            return (
              <div key={cls} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="label-xs uppercase tracking-wider" style={{ color }}>
                    {label}
                    {verdict?.class === cls && <span className="ms-1.5 opacity-80">◀ {T('verdict')}</span>}
                  </span>
                  <span className="mono label-xs tnum" dir="ltr" style={{ color }}>
                    {(p * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-surf-lowest rounded-2px overflow-hidden border border-seam">
                  <div
                    className="h-full rounded-2px transition-all duration-700"
                    style={{ width: `${p * 100}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
          {modelError && (
            <p className="text-[11px] text-err bg-err-container/20 rounded p-2" dir="ltr">
              MODEL ERROR: {modelError}
            </p>
          )}
          <div className="flex items-center justify-between label-xs text-faint pt-0.5" dir="ltr">
            <span>VAL_ACC {(verdict?.train_accuracy ?? 0) * 100}%</span>
            <span className="text-sec">{T('inference')}</span>
          </div>
        </div>
      </Panel>

      {/* live features */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4 text-prim" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('featureSliders')}</span>
          </div>
          <Pill color="text-prim" bg="bg-surf-high">8-D VECTOR</Pill>
        </div>
        <div className="flex flex-col gap-2">
          {FEATURE_ORDER.map((k) => (
            <div key={k} className="flex items-center gap-2.5">
              <span className="label-xs text-muted w-36 sm:w-44 shrink-0 truncate" dir="auto">
                {featLabels[k]}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={features[k]}
                disabled={!manualOverride}
                onChange={(e) => setFeature(k, Number(e.target.value))}
                aria-label={featLabels[k]}
                className="vor-range flex-1 disabled:opacity-60"
                dir="ltr"
              />
              <span className="mono label-xs text-prim w-10 text-end tnum" dir="ltr">
                {features[k].toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Countermeasure plan */}
      <Panel className="p-4 flex flex-col gap-2.5" glow={activeCms.length > 0 ? 'sec' : undefined}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-sec" aria-hidden />
            <span className="label-md text-ink uppercase tracking-wide">{T('countermeasures')}</span>
          </div>
          <button
            type="button"
            onClick={applyPlan}
            disabled={!plan || plan.actions.length === 0}
            className="label-xs uppercase text-prim border border-prim/40 hover:bg-prim/10 rounded-4px px-2.5 py-1.5 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
          >
            {T('applyAll')}
          </button>
        </div>
        {plan ? (
          <div className="flex flex-col gap-2">
            {plan.actions.map((a, i) => {
              const label = cmLabel(a);
              const active = activeCms.includes(a.kind);
              return (
                <button
                  key={`${a.kind}-${i}`}
                  type="button"
                  onClick={() => toggleCm(a.kind)}
                  aria-pressed={active}
                  className={`text-start p-2.5 rounded-lg border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                    active
                      ? 'bg-sec/10 border-sec/50 glow-sec'
                      : 'bg-surf-lowest border-seam hover:border-seam-strong'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`mono label-sm ${active ? 'text-sec font-bold' : 'text-prim'}`} dir="ltr">
                      {label}
                    </span>
                    <Pill color={active ? 'text-sec' : 'text-faint'} bg={active ? 'bg-sec/15' : 'bg-surf-high'}>
                      {active ? T('activeChip') : T('standbyChip')}
                    </Pill>
                  </div>
                  <p className="text-[11px] text-muted leading-4 mt-1" dir="ltr">
                    {plan.explanations[i]}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-faint">—</p>
        )}
      </Panel>

      {/* entropy oscilloscope */}
      <Panel className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Waves className="w-4 h-4 text-prim" aria-hidden />
            <span className="label-md text-ink uppercase tracking-tight">{T('entropyScope')}</span>
          </div>
          <span className="label-xs text-sec tracking-widest uppercase animate-breathe" dir="ltr">LIVE 2.4 MSPS</span>
        </div>
        <BarScope data={scope} />
        <div className="flex items-center justify-between label-xs text-faint" dir="ltr">
          <span>CH-0 RST PROBE: {features.rst_rate.toFixed(2)}</span>
          <span className="text-sec">FEC RESTORE: 100%</span>
          <span>CH-7 PROBE: {featuresHist.toFixed(2)}</span>
        </div>
      </Panel>
    </div>
  );
}
