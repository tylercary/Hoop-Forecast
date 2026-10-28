import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, AlertTriangle, Minus, Lock } from 'lucide-react';

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
  if (!Array.isArray(factors) || factors.length === 0) return null;
  const visible = signedIn ? factors : factors.filter(f => f.key !== 'model');
  const counts = visible.reduce((acc, f) => { acc[f.effect] = (acc[f.effect] || 0) + 1; return acc; }, {});
  const summary = [
    counts.over ? `${counts.over} toward the over` : null,
    counts.under ? `${counts.under} toward the under` : null,
    counts.caution ? `${counts.caution} caution${counts.caution > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="panel p-5 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">What's driving this {propLabel ? `${propLabel} ` : ''}pick</h4>
          <p className="text-xs text-slate-500 mt-0.5">{summary || 'Nothing pulling strongly either way'} · strongest first</p>
        </div>
        {!signedIn && (
          <button type="button" onClick={onSignIn} className="text-xs text-amber-400/80 hover:text-amber-300 inline-flex items-center gap-1">
            <Lock size={11} /> Sign in to see the model's read
          </button>
        )}
      </div>
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
    </motion.div>
  );
}

export default PickFactors;
