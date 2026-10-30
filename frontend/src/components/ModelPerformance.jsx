import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../utils/api';
import { Clock, CheckCircle, XCircle, MinusCircle, Zap, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Model Performance: the edge model's live track record, graded after every
 * game. Everything here comes from GET /api/performance/edge, the same grading
 * the weekly retrain job uses, so the site and the report cannot disagree.
 *
 * A "pick" is a prop where the model's probability cleared the thresholds
 * (>= 56% over / <= 44% under). A "lean" is everything else: the side of the
 * line the projection sits on, shown but not recommended.
 *
 * Overs and unders are always shown apart. The two sides have behaved
 * differently all season (unders calibrated, overs weaker), and a pooled hit
 * rate hides that.
 *
 * Closing line value (CLV) is available before results are: the backend
 * snapshots the market just before tip-off, and price CLV is how many no-vig
 * probability points the pick's side gained by the close.
 *
 * Only the model version running now is graded into the numbers (the backend
 * default, version=current). Earlier versions keep their own record in the
 * "Earlier versions" panel.
 */

const PROP_LABELS = {
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: '3-Pointers',
  pra: 'PRA', pr: 'Pts + Reb', pa: 'Pts + Ast', ra: 'Reb + Ast'
};
const propLabel = (p) => PROP_LABELS[p] || p;

const pct = (rate, digits = 1) => (rate == null ? '—' : `${(rate * 100).toFixed(digits)}%`);
const signed = (n, digits = 2) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`);
const record = (b) => (b && b.n ? `${b.hits}–${b.n - b.hits}` : '—');
const formatOdds = (o) => (o == null ? '—' : o > 0 ? `+${o}` : `${o}`);
const BREAK_EVEN = 0.524;

const rateColor = (rate, n = 1) => {
  if (rate == null || n === 0) return 'text-slate-500';
  if (rate >= 0.56) return 'text-emerald-400';
  if (rate >= BREAK_EVEN) return 'text-amber-400';
  return 'text-rose-400';
};
const barColor = (rate) => (rate >= 0.56 ? 'bg-emerald-400' : rate >= BREAK_EVEN ? 'bg-amber-400' : 'bg-rose-400');
const unitsColor = (u) => (u == null ? 'text-slate-500' : u > 0 ? 'text-emerald-400' : u < 0 ? 'text-rose-400' : 'text-slate-300');
const clvColor = (pts) => (pts == null ? 'text-slate-500' : pts >= 0.05 ? 'text-emerald-400' : pts <= -0.05 ? 'text-rose-400' : 'text-slate-300');
const fmtClvLine = (l) => (l == null ? '' : `${l > 0 ? '+' : ''}${l.toFixed(1)}`);
const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const fmtTip = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null);

/** The CLV block the tile describes: picks when any have a snapshot, else leans. */
function clvSummary(clv) {
  if (!clv || !clv.n) return null;
  if (clv.picks?.n) return { ...clv.picks, label: 'picks' };
  if (clv.leans?.n) return { ...clv.leans, label: 'leans' };
  return null;
}

const SECTION = 'panel p-6';
const LABEL = 'text-[11px] uppercase tracking-wider font-semibold text-slate-400';
const TH = 'text-[11px] uppercase tracking-wider font-semibold text-slate-500 py-2';

function Tile({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="py-3 sm:px-5 sm:first:pl-0 sm:last:pr-0 min-w-0">
      <p className={`${LABEL} mb-1.5`}>{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-none ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
  );
}

function Section({ title, sub, right, children, delay = 0 }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className={SECTION}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h4 className="panel-title">{title}</h4>
          {sub && <p className="panel-subtitle mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </motion.section>
  );
}

/** One side's record: rate, record, and a bar against break-even. */
function SideRow({ label, block, note }) {
  const n = block?.n || 0;
  const rate = block?.hit_rate;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className={`text-xl font-bold tabular-nums ${rateColor(rate, n)}`}>{n ? pct(rate) : '—'}</span>
      </div>
      <div className="mt-1.5 relative h-1.5 rounded-full bg-slate-700/60">
        <div className="absolute top-1/2 -translate-y-1/2 h-3 w-px bg-slate-500" style={{ left: `${BREAK_EVEN * 100}%` }} title="Break-even at −110" />
        {n > 0 && (
          <motion.div initial={{ width: 0 }} animate={{ width: `${(rate || 0) * 100}%` }} transition={{ duration: 0.5 }} className={`h-full rounded-full ${barColor(rate || 0)}`} />
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1.5">{n ? `${record(block)}${note ? ` · ${note}` : ''}` : 'nothing graded'}</p>
    </div>
  );
}

/** Overs beside unders, for picks (when any) and leans. */
function OverUnderPanel({ overall, delay }) {
  const recs = overall.recommendations || {};
  const leans = overall.leans || {};
  const hasPicks = recs.n > 0;
  const sides = [
    { key: 'over', title: 'Overs', icon: ArrowUp, tone: 'text-emerald-400', picks: recs.over, leans: leans.over_side },
    { key: 'under', title: 'Unders', icon: ArrowDown, tone: 'text-rose-400', picks: recs.under, leans: leans.under_side },
  ];
  return (
    <Section
      title="Overs vs unders"
      sub={`The two sides are graded apart · the line itself went over ${pct(overall.over_rate, 0)} of the time`}
      delay={delay}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-slate-700/60 gap-y-6 lg:gap-y-0">
        {sides.map((s, i) => {
          const Icon = s.icon;
          const total = (s.picks?.n || 0) + (s.leans?.n || 0);
          return (
            <div key={s.key} className={i === 0 ? 'lg:pr-10' : 'lg:pl-10'}>
              <div className="flex items-baseline justify-between border-b border-slate-700/60 pb-2">
                <span className={`inline-flex items-center gap-1.5 text-base font-semibold ${s.tone}`}>
                  <Icon size={16} /> {s.title}
                </span>
                <span className="text-xs text-slate-500">{total} graded</span>
              </div>
              <div className="divide-y divide-slate-800">
                {hasPicks && <SideRow label="Picks" block={s.picks} note="model cleared the threshold" />}
                <SideRow label={hasPicks ? 'Leans' : 'Leans (no picks yet)'} block={s.leans} note="projection's side, no pick" />
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ResultBadge({ result }) {
  if (result === 'hit') return <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold"><CheckCircle size={14} /> Hit</span>;
  if (result === 'miss') return <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-semibold"><XCircle size={14} /> Miss</span>;
  return <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-semibold"><MinusCircle size={14} /> Push</span>;
}

/** "52.6% (539–486)" cell for a side block. */
function RateCell({ block, digits = 1 }) {
  const n = block?.n || 0;
  if (!n) return <td className="py-2.5 text-right text-slate-600 tabular-nums">—</td>;
  return (
    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
      <span className={`font-semibold ${rateColor(block.hit_rate, n)}`}>{pct(block.hit_rate, digits)}</span>
      <span className="text-xs text-slate-500 ml-1.5">{record(block)}</span>
    </td>
  );
}

function ModelPerformance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allVersions, setAllVersions] = useState(false);

  useEffect(() => { fetchPerformance(); }, [allVersions]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPerformance = async () => {
    try {
      setLoading(true);
      const res = await api.get('/performance/edge', { params: { version: allVersions ? 'all' : 'current' } });
      setData(res.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching performance:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="panel h-44 animate-pulse" />
        <div className="panel h-64 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`${SECTION} text-center`}>
        <p className="text-rose-400 py-4">Could not load performance{error ? `: ${error}` : ''}</p>
        <button onClick={fetchPerformance} className="px-4 py-2 bg-amber-400 text-slate-900 rounded-lg hover:bg-amber-300 transition-colors font-semibold text-sm">
          Retry
        </button>
      </div>
    );
  }

  const { overall, by_prop: byProp = {}, by_week: byWeek = {}, recent = [], pending = { n: 0, picks: 0 }, thresholds, model_version: modelVersion, other_versions: otherVersions = {} } = data;
  const recs = overall?.recommendations || { n: 0, hits: 0 };
  const leans = overall?.leans || { n: 0, hits: 0 };
  const graded = overall?.n || 0;
  const since = overall?.date_range?.[0];
  const clv = clvSummary(overall?.clv);
  const earlier = Object.entries(otherVersions).sort(([a], [b]) => b.localeCompare(a));
  const hasPicks = recs.n > 0;

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h3 className="text-2xl font-bold text-white">Model performance</h3>
        <p className="text-sm text-slate-400 mt-0.5">
          {allVersions ? 'Every model version' : 'Current model'}{since ? ` since ${fmtDate(since)}` : ''} · graded after every game · picks need {thresholds?.over ?? 56}% or better
        </p>
        {modelVersion && (
          <p className="text-xs text-slate-500 mt-1">
            {allVersions ? 'Mixing all versions' : `Version ${modelVersion}`}
            {(earlier.length > 0 || allVersions) && (
              <>
                {' · '}
                <button type="button" onClick={() => setAllVersions(v => !v)} className="text-amber-400/80 hover:text-amber-300 underline underline-offset-2">
                  {allVersions ? 'show the current version only' : 'include earlier versions'}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {pending?.n > 0 && (
        <div className="text-xs text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
          <Clock size={14} className="text-amber-400" />
          {pending.n} awaiting results{pending.picks ? ` · ${pending.picks} picks` : ''}{pending.next_tip ? ` · next tip ${fmtTip(pending.next_tip)}` : ''}
        </div>
      )}
    </div>
  );

  const earlierPanel = earlier.length > 0 && !allVersions ? (
    <Section title="Earlier versions" sub="Retired models keep their own record here and are not counted above" delay={0.35}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/60">
              <th className={`${TH} text-left`}>Version</th>
              <th className={`${TH} text-left`}>Games</th>
              <th className={`${TH} text-right`}>Picks</th>
              <th className={`${TH} text-right`}>Units</th>
              <th className={`${TH} text-right`}>Leans</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {earlier.map(([v, s]) => (
              <tr key={v}>
                <td className="py-2.5 text-slate-300 whitespace-nowrap">{v === 'unversioned' ? 'Opening week' : v}</td>
                <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{s.date_range ? `${fmtDate(s.date_range[0])} – ${fmtDate(s.date_range[1])}` : '—'}</td>
                <RateCell block={s.picks} />
                <td className={`py-2.5 text-right tabular-nums ${unitsColor(s.picks?.units)}`}>{s.picks?.n ? signed(s.picks.units) : '—'}</td>
                <RateCell block={s.leans} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  ) : null;

  if (graded === 0) {
    return (
      <div className="space-y-6">
        <div className={SECTION}>
          {header}
          <div className="text-center py-10 mt-4 border-t border-slate-700/60">
            <p className="text-white font-semibold mb-1">No graded props yet</p>
            <p className="text-slate-400 text-sm">
              {pending?.n > 0
                ? `${pending.n} predictions are waiting on tonight's games. Results appear here once each game is final.`
                : 'Results appear here once the first games with predictions are final.'}
            </p>
          </div>
        </div>
        {earlierPanel}
      </div>
    );
  }

  const sortedProps = Object.entries(byProp).sort((a, b) => (b[1].recommendations?.n || 0) - (a[1].recommendations?.n || 0) || b[1].n - a[1].n);
  const weeks = Object.entries(byWeek).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12);
  const bins = Object.entries(overall.prob_bins || {}).filter(([, v]) => v.n >= 10);
  const confidence = overall.by_confidence || {};
  const confidenceTiers = ['High', 'Medium', 'Low'].filter(t => confidence[t]);
  const firstPick = overall.first_pick || { n: 0, hits: 0, side_changed: 0 };

  return (
    <div className="space-y-6">
      {/* Header and headline tiles */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={SECTION}>
        {header}
        <div className="mt-5 pt-5 border-t border-slate-700/60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 sm:divide-x divide-slate-700/60 gap-y-2">
          <Tile
            label="Picks"
            value={hasPicks ? pct(recs.hit_rate) : '—'}
            sub={hasPicks
              ? `${record(recs)}${recs.pushes ? `, ${recs.pushes} push` : ''} · over ${pct(recs.over?.hit_rate, 0)} · under ${pct(recs.under?.hit_rate, 0)}`
              : 'none yet · held until a player has 5 games this season'}
            accent={hasPicks ? rateColor(recs.hit_rate, recs.n) : 'text-slate-500'}
          />
          <Tile
            label="Units"
            value={recs.bets ? signed(recs.units) : '—'}
            sub={recs.bets ? `${pct(recs.roi)} ROI · 1u per pick at the best price` : 'flat 1u per pick'}
            accent={recs.bets ? unitsColor(recs.units) : 'text-slate-500'}
          />
          <Tile
            label="Leans"
            value={leans.n ? pct(leans.hit_rate) : '—'}
            sub={leans.n ? `${record(leans)} · over ${pct(leans.over_side?.hit_rate, 0)} · under ${pct(leans.under_side?.hit_rate, 0)}` : 'none graded yet'}
            accent={rateColor(leans.hit_rate, leans.n)}
          />
          <Tile
            label="Closing line value"
            value={clv && clv.mean_points != null ? <>{signed(clv.mean_points, 1)}<span className="text-sm font-semibold text-slate-400 ml-1">pts</span></> : clv ? fmtClvLine(clv.mean_line) || '—' : '—'}
            sub={clv
              ? `${clv.beat_close != null ? `${pct(clv.beat_close, 0)} beat the close` : 'price not captured yet'} · ${clv.n} ${clv.label}`
              : 'captured at tip-off'}
            accent={clv ? clvColor(clv.mean_points ?? clv.mean_line) : 'text-slate-500'}
          />
          <Tile
            label="Graded"
            value={graded.toLocaleString()}
            sub={`${overall.pushes || 0} pushes · ${firstPick.side_changed || 0} changed side before tip`}
          />
        </div>
      </motion.section>

      <OverUnderPanel overall={overall} delay={0.05} />

      {confidenceTiers.length > 0 && (
        <Section title="Picks by confidence" sub="High means the model sat 9+ points from 50/50; Medium 5+; Low under 5" delay={0.1}>
          <div className="divide-y divide-slate-800">
            {confidenceTiers.map((tier) => {
              const c = confidence[tier];
              return (
                <div key={tier} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-white">{tier}</p>
                    <p className="text-xs text-slate-500">{record(c)} · {signed(c.units)}u</p>
                  </div>
                  <span className={`text-xl font-bold tabular-nums ${rateColor(c.hit_rate, c.n)}`}>{pct(c.hit_rate)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {sortedProps.length > 0 && (
        <Section title="By prop" sub="Each market's record, with overs and unders apart" delay={0.15}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60">
                  <th className={`${TH} text-left`}>Prop</th>
                  {hasPicks && <th className={`${TH} text-right`}>Picks</th>}
                  {hasPicks && <th className={`${TH} text-right`}>Units</th>}
                  <th className={`${TH} text-right`}>Leans</th>
                  <th className={`${TH} text-right`}>Overs</th>
                  <th className={`${TH} text-right`}>Unders</th>
                  <th className={`${TH} text-right`}>CLV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedProps.map(([prop, s]) => {
                  const r = s.recommendations || { n: 0 };
                  const l = s.leans || { n: 0 };
                  // Overs and unders from picks when the prop has any, else from leans
                  const over = r.n ? r.over : l.over_side;
                  const under = r.n ? r.under : l.under_side;
                  const c = clvSummary(s.clv);
                  return (
                    <tr key={prop}>
                      <td className="py-2.5 text-white font-medium whitespace-nowrap">{propLabel(prop)}</td>
                      {hasPicks && <RateCell block={r} />}
                      {hasPicks && <td className={`py-2.5 text-right tabular-nums ${unitsColor(r.units)}`}>{r.bets ? signed(r.units) : '—'}</td>}
                      <RateCell block={l} />
                      <RateCell block={over} digits={0} />
                      <RateCell block={under} digits={0} />
                      <td className={`py-2.5 text-right tabular-nums text-xs whitespace-nowrap ${c ? clvColor(c.mean_points ?? c.mean_line) : 'text-slate-600'}`}>
                        {c && c.mean_points != null ? `${signed(c.mean_points, 1)} pts` : c ? fmtClvLine(c.mean_line) || '—' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {weeks.length > 0 && (
          <Section title="Week by week" sub="Drift shows up here first" delay={0.2}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60">
                    <th className={`${TH} text-left`}>Week</th>
                    {hasPicks && <th className={`${TH} text-right`}>Picks</th>}
                    {hasPicks && <th className={`${TH} text-right`}>Units</th>}
                    <th className={`${TH} text-right`}>Leans</th>
                    <th className={`${TH} text-right`}>Overs</th>
                    <th className={`${TH} text-right`}>Unders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {weeks.map(([week, s]) => {
                    const r = s.recommendations || { n: 0 };
                    const l = s.leans || { n: 0 };
                    const over = r.n ? r.over : l.over_side;
                    const under = r.n ? r.under : l.under_side;
                    return (
                      <tr key={week}>
                        <td className="py-2.5 text-slate-300 whitespace-nowrap">{week.replace('-W', ' · wk ')}</td>
                        {hasPicks && <RateCell block={r} />}
                        {hasPicks && <td className={`py-2.5 text-right tabular-nums ${unitsColor(r.units)}`}>{r.bets ? signed(r.units) : '—'}</td>}
                        <RateCell block={l} />
                        <RateCell block={over} digits={0} />
                        <RateCell block={under} digits={0} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {bins.length > 0 && (
          <Section title="Said vs happened" sub="Stated over probability against how often the over actually hit" delay={0.25}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60">
                  <th className={`${TH} text-left`}>Model said</th>
                  <th className={`${TH} text-right`}>Over hit</th>
                  <th className={`${TH} text-right`}>Gap</th>
                  <th className={`${TH} text-right`}>Props</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {bins.map(([bin, v]) => {
                  const gap = v.actual_over - v.stated_over;
                  const gapColor = Math.abs(gap) <= 0.05 ? 'text-emerald-400' : Math.abs(gap) <= 0.1 ? 'text-amber-400' : 'text-rose-400';
                  return (
                    <tr key={bin}>
                      <td className="py-2.5 text-slate-300">{bin}% <span className="text-xs text-slate-500">(avg {pct(v.stated_over, 0)})</span></td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-white">{pct(v.actual_over, 0)}</td>
                      <td className={`py-2.5 text-right tabular-nums ${gapColor}`}>{signed(gap * 100, 1)}</td>
                      <td className="py-2.5 text-right text-slate-400 tabular-nums">{v.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {overall.calibration_slope != null ? (
              <p className="text-xs text-slate-500 mt-3">Calibration slope {overall.calibration_slope.toFixed(2)} · 1.00 means the stated probabilities match reality</p>
            ) : (
              <p className="text-xs text-slate-500 mt-3">Calibration slope needs a wider spread of stated probabilities than this version has produced so far</p>
            )}
          </Section>
        )}
      </div>

      {recent.length > 0 && (
        <Section title="Recent graded props" sub="Picks are marked with a bolt; leans are shown for the record · CLV is the side's no-vig price gain by the close, in points" delay={0.3}>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60">
                  <th className={`${TH} text-left px-2`}>Result</th>
                  <th className={`${TH} text-left px-2`}>Player</th>
                  <th className={`${TH} text-left px-2`}>Prop</th>
                  <th className={`${TH} text-right px-2`}>Line</th>
                  <th className={`${TH} text-right px-2`}>Side</th>
                  <th className={`${TH} text-right px-2`}>Prob</th>
                  <th className={`${TH} text-right px-2`}>Actual</th>
                  {hasPicks && <th className={`${TH} text-right px-2`}>Price</th>}
                  {hasPicks && <th className={`${TH} text-right px-2`}>Units</th>}
                  <th className={`${TH} text-right px-2`}>CLV</th>
                  <th className={`${TH} text-left px-2`}>Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recent.map((r, i) => (
                  <tr key={r.id || i} className={`hover:bg-slate-800/40 transition-colors ${r.pick ? 'bg-amber-400/5' : ''}`}>
                    <td className="py-2 px-2"><ResultBadge result={r.result} /></td>
                    <td className="py-2 px-2 text-white font-medium whitespace-nowrap">
                      {r.player}{r.pick && <Zap size={12} className="inline ml-1 text-amber-400" />}
                      {r.opponent && <span className="text-slate-500 text-xs ml-1">vs {r.opponent}</span>}
                    </td>
                    <td className="py-2 px-2 text-slate-300 whitespace-nowrap">{propLabel(r.prop)}</td>
                    <td className="py-2 px-2 text-right text-slate-300 tabular-nums">{r.line?.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                      {r.side ? (
                        <span className={`inline-flex items-center justify-end gap-1 ${r.side === 'OVER' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.side === 'OVER' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                          {r.side === 'OVER' ? 'O' : 'U'} {r.projection?.toFixed(1)}
                          {!r.pick && <span className="text-[10px] font-normal text-slate-500 ml-1">lean</span>}
                        </span>
                      ) : <span className="text-slate-500">—</span>}
                      {r.side_changed && r.first_side && (
                        <div className="text-[10px] font-normal text-slate-500" title="Side shown when the prop first appeared">
                          was {r.first_side === 'OVER' ? 'O' : 'U'} {r.first_line != null ? r.first_line.toFixed(1) : ''}{r.first_result ? ` · ${r.first_result}` : ''}
                        </div>
                      )}
                    </td>
                    <td className={`py-2 px-2 text-right text-xs font-medium tabular-nums ${r.prob >= 56 ? 'text-emerald-400' : r.prob >= 52.4 ? 'text-amber-400' : 'text-slate-400'}`}>{r.prob != null ? `${r.prob.toFixed(0)}%` : '—'}</td>
                    <td className="py-2 px-2 text-right text-white font-semibold tabular-nums">{r.actual != null ? r.actual : '—'}</td>
                    {hasPicks && <td className="py-2 px-2 text-right text-slate-400 text-xs whitespace-nowrap">{r.pick ? `${formatOdds(r.odds)}${r.book ? ` ${r.book}` : ''}` : '—'}</td>}
                    {hasPicks && <td className={`py-2 px-2 text-right tabular-nums text-xs ${unitsColor(r.units)}`}>{r.units != null ? signed(r.units) : '—'}</td>}
                    <td className={`py-2 px-2 text-right tabular-nums text-xs whitespace-nowrap ${clvColor(r.clv_points ?? r.clv_line)}`}
                      title={r.clv_line != null ? `Line moved ${fmtClvLine(r.clv_line)} toward the pick by the close${r.beat_close != null ? r.beat_close ? ' · beat the close' : ' · did not beat the close' : ''}` : undefined}>
                      {r.clv_points != null ? signed(r.clv_points, 1) : r.clv_line != null ? fmtClvLine(r.clv_line) : '—'}
                      {r.beat_close === true && <CheckCircle size={11} className="inline ml-1 text-emerald-400" />}
                    </td>
                    <td className="py-2 px-2 text-slate-500 text-xs whitespace-nowrap">{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {earlierPanel}
    </div>
  );
}

export default ModelPerformance;
