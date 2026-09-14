'use client';

/**
 * Shared command bar — status strip (HW TAMPER / ED25519 / cipher) + brand row
 * with the shield emblem, CLIENT/MANAGER segmented switch and FA/EN toggle.
 */
import Image from 'next/image';
import { Languages, Lock, CircleUserRound, ShieldCheck } from 'lucide-react';
import { useVor } from '@/lib/vor/store';
import { Pill } from './primitives';
import { t } from '@/lib/vor/store';

export function Header({ subline }: { subline: string }) {
  const lang = useVor((s) => s.lang);
  const view = useVor((s) => s.view);
  const setLang = useVor((s) => s.setLang);
  const setView = useVor((s) => s.setView);
  const activated = useVor((s) => s.activated);
  const T = t(lang);

  return (
    <header className="sticky top-0 z-40 bg-canvas/85 backdrop-blur-xl border-b border-seam shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-2.5 flex flex-col gap-1.5">
        {/* status strip */}
        <div className="flex items-center justify-between gap-2 min-w-0" dir="ltr">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-sec animate-breathe shrink-0" aria-hidden />
            <span className="label-xs uppercase text-sec truncate">{T('hwTamper')}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Pill color="text-sec" bg="bg-surf-high" className="truncate">
              <ShieldCheck className="w-3 h-3 shrink-0" aria-hidden />
              <span className="truncate">{activated ? T('edVerified') : 'ED25519 READY'}</span>
            </Pill>
            <span className="label-xs uppercase text-prim hidden sm:flex items-center gap-1 shrink-0">
              <Lock className="w-3 h-3" aria-hidden />
              CHACHA20-POLY1305
            </span>
          </div>
        </div>

        {/* brand row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Image
              src="/vor_shield_emblem.png"
              alt="VOR Shield Emblem"
              width={32}
              height={32}
              className="h-8 w-8 object-contain shrink-0"
              priority
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[17px] leading-none font-bold tracking-tight text-ink uppercase truncate">
                {T('brand')}
              </span>
              <span className="label-xs text-ink-var uppercase tracking-wider truncate">{subline}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* CLIENT / MANAGER segmented switch */}
            <div
              className="flex items-center bg-surf-lowest border border-seam rounded-4px p-0.5"
              role="tablist"
              aria-label="View switch"
            >
              {(['client', 'manager'] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`label-xs uppercase px-2 py-1 rounded-2px transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action ${
                    view === v ? 'bg-prim-deep text-[#f8fafc]' : 'text-muted hover:text-ink'
                  }`}
                >
                  {T(v)}
                </button>
              ))}
            </div>
            {/* language toggle */}
            <button
              type="button"
              onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
              aria-label="Toggle language / تغییر زبان"
              className="h-8 px-2 flex items-center gap-1 rounded-4px border border-seam text-muted hover:text-ink hover:border-seam-strong transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-prim-action"
            >
              <Languages className="w-3.5 h-3.5" aria-hidden />
              <span className="label-xs font-bold">{lang === 'fa' ? 'EN' : 'فا'}</span>
            </button>
            <div
              className="w-8 h-8 rounded-full bg-prim flex items-center justify-center shrink-0"
              role="img"
              aria-label="Operator avatar"
            >
              <CircleUserRound className="w-5 h-5 text-on-prim" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
