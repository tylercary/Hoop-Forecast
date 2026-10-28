import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, AlertTriangle, Minus, Lock, ChevronDown } from 'lucide-react';

/**
 * What is influencing the pick for the selected prop: recent form, where the
 * line sits against the averages, the opponent's defense and pace, injuries
 * on both teams, rest, consistency and the early-season guard. Comes from the
 * prediction's `factors` (backend pickFactorsService), ordered by weight.
 *
 * The model's own read ("Model vs line") is part of the signed-in view, like
 * the projection tile; everything else is shown to everyone.
 */

const STYLE = {
  over: { text: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/5', Icon: ArrowUp, word: 'Over' },
  under: { text: 'text-rose-400', ring: 'border-rose-500/30 bg-rose-500/5', Icon: ArrowDown, word: 'Under' },
  caution: { text: 'text-amber-400', ring: 'border-amber-500/30 bg-amber-500/5', Icon: AlertTriangle, word: 'Caution' },
  neutral: { text: 'text-slate-400', ring: 'border-slate-700/60 bg-slate-800/40', Icon: Minus, word: 'Neutral' },
};

function PickFactors({ factors, propLabel, signedIn = true, onSignIn }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(factors) || factors.length === 0) return null;
  const visible = signedIn ? factors : factors.filter(f => f.key !== 'model');
  // Collapsed view: the strongest few factors as chips
  const top = visible.slice(0, 3);
  const counts = visible.reduce((acc, f) => { acc[f.effect] = (acc[f.effect] || 0) + 1; return acc; }, {});
  const summary = [
    counts.over ? `${counts.over} toward the over` : null,
    counts.under ? `${counts.under} toward the under` : null,
    counts.caution ? `${counts.caution} caution${counts.caution > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="panel mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
      >
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-200">What's driving this {propLabel ? `${propLabel} ` : ''}pick</h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!open && top.map(f => {
              const st = STYLE[f.effect] || STYLE.neutral;
              const Icon = st.Icon;
              return (
                <span key={f.key} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.ring} ${st.text}`}>
                  <Icon size={11} /> {f.label}
                </span>
              );
            })}
            {!open && visible.length > top.length && <span className="text-[11px] text-slate-500">+{visible.length - top.length} more</span>}
            {open && <span className="text-xs text-slate-500">{summary || 'Nothing pulling strongly either way'} · strongest first</span>}
          </div>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="px-5 pb-5">
              {!signedIn && (
                <button type="button" onClick={onSignIn} className="mb-3 text-xs text-amber-400/80 hover:text-amber-300 inline-flex items-center gap-1">
                  <Lock size={11} /> Sign in to see the model's read
                </button>
              )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {visible.map((f, i) => {
          const st = STYLE[f.effect] || STYLE.neutral;
          const Icon = st.Icon;
          return (
            <motion.div key={f.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
              className={`rounded-lg border px-3.5 py-3 flex gap-3 ${st.ring}`}>
              <div className={`mt-0.5 shrink-0 ${st.text}`}><Icon size={16} /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-200">{f.label}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${st.text}`}>{st.word}</span>
                  {f.weight >= 3 && <span className="text-[10px] text-slate-500">strong</span>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{f.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default PickFactors;
