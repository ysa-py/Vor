'use client';

/**
 * VOR app shell — boots the runtime, starts the 1 Hz engine loop, and routes
 * the three views (License Gate / Client / Manager) inside the single route.
 */
import { useEffect } from 'react';
import { Activity, Radar, Settings, Shield, Waves } from 'lucide-react';
import {
  startEngine,
  stopEngine,
  useVor,
  t,
} from '@/lib/vor/store';
import { Header } from './Header';
import { LicenseGate } from './LicenseGate';
import { ManagerView } from './ManagerView';
import { TunnelTab } from './TunnelTab';
import { AnalyticsTab } from './AnalyticsTab';
import { DefenseTab } from './DefenseTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { SettingsTab } from './SettingsTab';
import type { ClientTab } from '@/lib/vor/store';

const TAB_ICONS = {
  tunnel: Shield,
  analytics: Activity,
  defense: Radar,
  diagnostics: Waves,
  settings: Settings,
} as const;

const TAB_KEYS: Record<ClientTab, string> = {
  tunnel: 'navTunnel',
  analytics: 'navAnalytics',
  defense: 'navDefense',
  diagnostics: 'navDiagnostics',
  settings: 'navSettings',
};

const SUB_KEYS: Record<string, [string, string]> = {
  tunnel: ['تونل امن', 'Tunnel'],
  analytics: ['تحلیل پیشرفته شبکه', 'Network Analytics'],
  defense: ['ماتریس دفاع خودکار', 'AI Defense Matrix'],
  diagnostics: ['بازرس تهدید', 'Threat Inspector'],
  settings: ['پیکربندی هسته', 'Kernel Config'],
};

function BootSplash() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-canvas">
      <img
        src="/vor_shield_emblem.png"
        alt="VOR"
        className="h-20 w-20 object-contain animate-breathe"
      />
      <div className="flex flex-col items-center gap-1.5" dir="ltr">
        <span className="font-mono text-[11px] tracking-[0.3em] text-sec uppercase">
          VOR SECURE RUNTIME
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase">
          initializing enclave — offline mode
        </span>
      </div>
      <div className="w-40 h-0.5 bg-surf-high overflow-hidden rounded-full">
        <div className="h-full w-1/3 bg-sec animate-[scan_1.4s_ease-in-out_infinite_alternate]" />
      </div>
    </div>
  );
}

function TabBar() {
  const lang = useVor((s) => s.lang);
  const tab = useVor((s) => s.tab);
  const setTab = useVor((s) => s.setTab);
  const T = t(lang);

  const items = (Object.keys(TAB_ICONS) as ClientTab[]).map((k) => {
    const Icon = TAB_ICONS[k];
    const active = tab === k;
    return (
      <button
        key={k}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab(k)}
        className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 min-h-[52px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action rounded-4px ${
          active ? 'text-sec' : 'text-faint hover:text-muted'
        }`}
      >
        <Icon className="w-[18px] h-[18px]" aria-hidden />
        <span className="label-xs uppercase tracking-wider">{T(TAB_KEYS[k])}</span>
        <span
          className={`h-0.5 w-6 rounded-full transition-all ${active ? 'bg-sec' : 'bg-transparent'}`}
          aria-hidden
        />
      </button>
    );
  });

  return (
    <nav
      className="sticky bottom-0 z-40 bg-canvas/90 backdrop-blur-xl border-t border-seam pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Primary"
    >
      <div className="mx-auto w-full max-w-3xl flex items-stretch px-2">{items}</div>
    </nav>
  );
}

export function VorShell() {
  const booted = useVor((s) => s.booted);
  const view = useVor((s) => s.view);
  const lang = useVor((s) => s.lang);
  const tab = useVor((s) => s.tab);
  const boot = useVor((s) => s.boot);
  const managerUnlocked = useVor((s) => s.managerUnlocked);
  const activated = useVor((s) => s.activated);
  const T = t(lang);

  useEffect(() => {
    void boot();
    startEngine();
    return () => stopEngine();
  }, []);

  if (!booted) return <BootSplash />;

  // Fail-closed gate: the client UI can NEVER render without a verified
  // license, no matter what view state says (mirrors verify.rs authority).
  const effectiveView = view === 'client' && !activated ? 'gate' : view;

  if (effectiveView === 'gate') {
    return (
      <div className="min-h-dvh flex flex-col bg-canvas">
        <Header subline={lang === 'fa' ? 'دروازهٔ مجوز' : 'License Gate'} />
        <main className="flex-1">
          <LicenseGate />
        </main>
      </div>
    );
  }

  if (view === 'manager') {
    return (
      <div className="min-h-dvh flex flex-col bg-canvas">
        <Header subline={lang === 'fa' ? 'مدیریت مجوز — ابزار مدیر' : 'License Manager — Admin'} />
        <main className="flex-1">
          {managerUnlocked ? (
            <ManagerView />
          ) : (
            <ManagerUnlock />
          )}
        </main>
      </div>
    );
  }

  const [subFa, subEn] = SUB_KEYS[tab];

  return (
    <div className="min-h-dvh flex flex-col bg-canvas">
      <Header subline={lang === 'fa' ? subFa : subEn} />
      <main className="flex-1 pb-2">
        {tab === 'tunnel' && <TunnelTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'defense' && <DefenseTab />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
      <TabBar />
      {/* keep T referenced for i18n side-effects in strict builds */}
      <span className="sr-only">{T('brand')}</span>
    </div>
  );
}

function ManagerUnlock() {
  const lang = useVor((s) => s.lang);
  const setManagerUnlocked = useVor((s) => s.setManagerUnlocked);
  const logEvent = useVor((s) => s.logEvent);
  const fa = lang === 'fa';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="bg-surf-low border border-seam rounded-8px p-6 flex flex-col gap-4 max-w-md mx-auto">
        <div className="flex items-center gap-2" dir="ltr">
          <Shield className="w-5 h-5 text-tert" aria-hidden />
          <span className="label-xs uppercase text-tert tracking-widest">
            ADMIN AUTHORIZATION
          </span>
        </div>
        <p className="text-sm text-ink-var leading-6">
          {fa
            ? 'مدیر مجوز VOR یک ابزار کاملاً جداگانه برای مدیر سیستم است (در نسخهٔ نهایی به‌صورت اپ مستقل عرضه می‌شود). برای پیش‌نمایش، هر گذرواژهٔ ۴ نویسه‌ای یا بیشتر کار می‌کند.'
            : 'The VOR License Manager is a fully separate administrative tool (ships as a standalone app in production). For this preview any 4+ character passcode unlocks it.'}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem('pass') as HTMLInputElement);
            if (input.value.trim().length >= 4) {
              setManagerUnlocked(true);
              logEvent('manager', 'ok', 'manager console unlocked (demo passcode accepted)');
            } else {
              input.setCustomValidity(fa ? 'حداقل ۴ نویسه' : 'min 4 characters');
              input.reportValidity();
            }
          }}
          className="flex flex-col gap-3"
        >
          <input
            name="pass"
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder={fa ? 'گذرواژهٔ مدیر' : 'Admin passcode'}
            aria-label={fa ? 'گذرواژهٔ مدیر' : 'Admin passcode'}
            className="h-[38px] bg-surf-lowest border border-seam rounded-4px px-3 font-mono text-sm text-ink placeholder:text-faint focus:outline-none focus:border-prim-action focus:ring-1 focus:ring-prim-action"
            dir="ltr"
          />
          <button
            type="submit"
            className="h-9 bg-prim-deep hover:bg-prim-action text-[#f8fafc] label-xs uppercase tracking-widest rounded-4px transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
          >
            {fa ? 'باز کردن کنسول' : 'UNLOCK CONSOLE'}
          </button>
        </form>
      </div>
    </div>
  );
}
