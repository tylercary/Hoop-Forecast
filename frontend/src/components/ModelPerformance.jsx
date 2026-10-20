import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../utils/api';
import { Target, BarChart3, CheckCircle, XCircle, Clock, MinusCircle, Zap, Scale, Coins, ArrowUp, ArrowDown, TrendingUp } from 'lucide-react';

/**
 * Model Performance: the edge model's live track record, graded after every
 * game. Everything here comes from GET /api/performance/edge, the same grading
 * the weekly retrain job uses, so the site and the report cannot disagree.
 *
 * A "pick" is a prop where the model's probability cleared the thresholds
 * (>= 56% over / <= 44% under). A "lean" is everything else: the side of the
 * line the projection sits on, shown but not recommended.
 *
 * Closing line value (CLV) is available before results are: the backend
 * snapshots the market just before tip-off, and price CLV is how many no-vig
 * probability points the pick's side gained by the close. Positive means the
 * books moved toward the pick.
 */

const PROP_LABELS = {
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: '3-Pointers',
  pra: 'PRA', pr: 'Pts + Reb', pa: 'Pts + Ast', ra: 'Reb + Ast'
};
const propLabel = (p) => PROP_LABELS[p] || p;

const pct = (rate, digits = 1) => (rate == null ? '-' : `${(rate * 100).toFixed(digits)}%`);
const signed = (n, digits = 2) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}`);
const formatOdds = (o) => (o == null ? '-' : o > 0 ? `+${o}` : `${o}`);
const BREAK_EVEN = 0.524;

const rateColor = (rate, n = 1) => {
  if (rate == null || n === 0) return 'text-slate-400';
  if (rate >= 0.56) return 'text-emerald-400';
  if (rate >= BREAK_EVEN) return 'text-amber-400';
  return 'text-rose-400';
};
const unitsColor = (u) => (u == null ? 'text-slate-400' : u > 0 ? 'text-emerald-400' : u < 0 ? 'text-rose-400' : 'text-slate-300');
const clvColor = (pts) => (pts == null ? 'text-slate-400' : pts >= 0.05 ? 'text-emerald-400' : pts <= -0.05 ? 'text-rose-400' : 'text-slate-300');
const fmtClvLine = (l) => (l == null ? '' : `${l > 0 ? '+' : ''}${l.toFixed(1)}`);

/**
 * The CLV side the tile describes: picks when any have a snapshot, else leans.
 * Returns null until the first snapshot lands.
 */
function clvSummary(clv) {
  if (!clv || !clv.n) return null;
  if (clv.picks?.n) return { ...clv.picks, label: 'picks' };
  if (clv.leans?.n) return { ...clv.leans, label: 'leans' };
  return null;
}

function ClvTile({ clv, delay = 0 }) {
  const s = clvSummary(clv);
  return (
    <Tile
      title="Closing line value"
      value={s && s.mean_points != null
        ? <>{signed(s.mean_points, 1)}<span className="text-sm font-semibold text-slate-400 ml-1">pts</span></>
        : s ? fmtClvLine(s.mean_line) || '-' : '-'}
      sub={s
        ? `${s.beat_close != null ? `${pct(s.beat_close, 0)} beat the close` : 'price not captured yet'} · ${s.n} ${s.label}${s.mean_line != null ? ` · line ${fmtClvLine(s.mean_line)}` : ''}`
        : 'Captured at tip-off; shows before results'}
      color={s ? clvColor(s.mean_points ?? s.mean_line) : 'text-slate-400'}
      icon={TrendingUp} iconColor="text-slate-400" delay={delay}
    />
  );
}
const barColor = (rate) => (rate >= 0.56 ? 'bg-emerald-400' : rate >= BREAK_EVEN ? 'bg-amber-400' : 'bg-rose-400');

const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-');
const fmtTip = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null);

function Tile({ title, value, sub, color = 'text-white', icon: Icon, iconColor = 'text-slate-400', delay = 0, accent = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.2 }}
      className={`rounded-lg p-4 bg-slate-800/70 border ${accent ? 'border-amber-500/30' : 'border-slate-700/60'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${accent ? 'text-amber-400' : 'text-slate-400'}`}>{title}</span>
        {Icon && <Icon className={iconColor} size={18} />}
      </div>
      <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </motion.div>
  );
}

function ResultBadge({ result }) {
  if (result === 'hit') return <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold"><CheckCircle size={14} /> HIT</span>;
  if (result === 'miss') return <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-semibold"><XCircle size={14} /> MISS</span>;
  return <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-semibold"><MinusCircle size={14} /> PUSH</span>;
}

function ModelPerformance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchPerformance(); }, []);

  const fetchPerformance = async () => {
    try {
      setLoading(true);
      const res = await api.get('/performance/edge');
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
      <div className="panel p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-400"></div>
          <span className="ml-4 text-slate-400">Loading model performance...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel p-6">
        <p className="text-rose-400 text-center py-4">Could not load performance{error ? `: ${error}` : ''}</p>
        <button onClick={fetchPerformance} className="mt-2 mx-auto block px-4 py-2 bg-amber-400 text-slate-900 rounded-lg hover:bg-amber-300 transition-colors font-semibold">
          Retry
        </button>
      </div>
    );
  }

  const { overall, by_prop: byProp = {}, by_week: byWeek = {}, recent = [], pending = { n: 0, picks: 0 }, thresholds } = data;
  const recs = overall?.recommendations || { n: 0, hits: 0 };
  const leans = overall?.leans || { n: 0, hits: 0 };
  const graded = overall?.n || 0;
  const since = overall?.date_range?.[0];
  const clv = overall?.clv || null;
  const hasClv = !!(clv && clv.n);

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-6">
      <div>
        <h3 className="panel-title text-2xl flex items-center gap-2">
          <Target className="text-amber-400" size={26} />
          Model Performance
        </h3>
        <p className="panel-subtitle mt-1">
          Live record of the edge model{since ? ` since ${fmtDate(since)}` : ''} · picks need {thresholds?.over ?? 56}% or better · graded after every game
        </p>
      </div>
      {pending?.n > 0 && (
        <div className="text-xs text-slate-400 flex items-center gap-1.5">
          <Clock size={14} className="text-amber-400" />
          {pending.n} awaiting results{pending.picks ? ` (${pending.picks} picks)` : ''}{pending.next_tip ? ` · next tip ${fmtTip(pending.next_tip)}` : ''}
        </div>
      )}
    </div>
  );

  if (graded === 0) {
    return (
      <div className="panel p-6">
        {header}
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
            <BarChart3 className="text-slate-500" size={32} />
          </div>
          <p className="text-white text-lg font-semibold mb-1">No graded picks yet</p>
          <p className="text-slate-400 text-sm">
            {pending?.n > 0
              ? `${pending.n} predictions are waiting on tonight's games. Results appear here once each game is final.`
              : 'Results appear here once the first games with predictions are final.'}
          </p>
        </div>
        {hasClv && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
            <ClvTile clv={clv} delay={0.05} />
          </div>
        )}
      </div>
    );
  }

  // Calibration of the pick buckets: what the model said vs what happened
  const bucketOver = overall.prob_buckets?.[`>=${thresholds?.over ?? 56}`];
  const bucketUnder = overall.prob_buckets?.[`<=${thresholds?.under ?? 44}`];
  const calibrationLine = [
    bucketOver ? `overs said ${pct(bucketOver.stated_over, 0)}, hit ${pct(bucketOver.actual_over, 0)}` : null,
    bucketUnder ? `unders said ${pct(1 - bucketUnder.stated_over, 0)}, hit ${pct(1 - bucketUnder.actual_over, 0)}` : null
  ].filter(Boolean).join(' · ');

  const sortedProps = Object.entries(byProp).sort((a, b) => (b[1].recommendations?.n || 0) - (a[1].recommendations?.n || 0) || b[1].n - a[1].n);
  const weeks = Object.entries(byWeek).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12);
  const bins = Object.entries(overall.prob_bins || {}).filter(([, v]) => v.n >= 10);
  const confidence = overall.by_confidence || {};

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel p-6">
        {header}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Tile
            title="Picks"
            value={recs.n ? pct(recs.hit_rate) : '-'}
            sub={recs.n ? `${recs.hits}-${recs.n - recs.hits}${recs.pushes ? `-${recs.pushes}` : ''} · break-even 52.4%` : 'No picks graded yet'}
            color={rateColor(recs.hit_rate, recs.n)}
            icon={Zap} iconColor="text-amber-400" accent delay={0.05}
          />
          <Tile
            title="Units"
            value={recs.bets ? signed(recs.units) : '-'}
            sub={recs.bets ? `${pct(recs.roi)} ROI · 1u per pick at the best price` : 'Flat 1u per pick'}
            color={unitsColor(recs.units)}
            icon={Coins} iconColor="text-amber-400" delay={0.1}
          />
          <Tile
            title="Leans"
            value={leans.n ? pct(leans.hit_rate) : '-'}
            sub={leans.n ? `${leans.hits}-${leans.n - leans.hits} · projection's side, no pick` : 'No leans graded yet'}
            color={rateColor(leans.hit_rate, leans.n)}
            icon={Scale} iconColor="text-slate-400" delay={0.15}
          />
          <Tile
            title="Calibration"
            value={overall.calibration_slope != null ? overall.calibration_slope.toFixed(2) : '-'}
            sub={overall.calibration_slope != null ? '1.00 = probabilities match reality' : 'Needs 30+ graded props'}
            color={overall.calibration_slope == null ? 'text-slate-400' : overall.calibration_slope >= 0.7 ? 'text-emerald-400' : overall.calibration_slope >= 0.4 ? 'text-amber-400' : 'text-rose-400'}
            icon={BarChart3} iconColor="text-slate-400" delay={0.2}
          />
          <ClvTile clv={clv} delay={0.25} />
          <Tile
            title="Graded"
            value={graded}
            sub={`${overall.pushes || 0} pushes · line went over ${pct(overall.over_rate, 0)} of the time`}
            color="text-white"
            icon={CheckCircle} iconColor="text-slate-400" delay={0.3}
          />
        </div>
        {calibrationLine && <p className="text-xs text-slate-500 mt-3">{calibrationLine}</p>}
      </motion.div>

      {Object.keys(confidence).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="panel p-6">
          <h4 className="panel-title mb-1">Picks by confidence</h4>
          <p className="panel-subtitle mb-4">High means the model sat 9+ points from 50/50; Medium 5+; Low under 5</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {['High', 'Medium', 'Low'].filter(t => confidence[t]).map((tier) => {
              const c = confidence[tier];
              return (
                <div key={tier} className="rounded-lg p-4 bg-slate-800/70 border border-slate-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{tier}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{c.hits}-{c.n - c.hits} · {signed(c.units)}u</div>
                  </div>
                  <div className={`text-2xl font-bold tabular-nums ${rateColor(c.hit_rate, c.n)}`}>{pct(c.hit_rate)}</div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {sortedProps.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="panel p-6">
          <h4 className="panel-title mb-1">By prop</h4>
          <p className="panel-subtitle mb-4">Pick record per market; leans shown where the model has not made a pick yet</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {sortedProps.map(([prop, s], i) => {
              const r = s.recommendations || { n: 0 };
              const usePicks = r.n > 0;
              const block = usePicks ? r : (s.leans || { n: 0 });
              return (
                <motion.div key={prop} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.03 }}
                  className="rounded-lg p-4 bg-slate-800/70 border border-slate-700/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-slate-200">{propLabel(prop)}</span>
                    <span className={`text-lg font-bold tabular-nums ${rateColor(block.hit_rate, block.n)}`}>{block.n ? pct(block.hit_rate) : '-'}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {block.n ? `${block.hits}-${block.n - block.hits} ${usePicks ? 'picks' : 'leans'}` : 'nothing graded'}
                    {usePicks && r.units != null ? ` · ${signed(r.units)}u` : ''}
                  </div>
                  <div className="mt-2 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                    {block.n > 0 && (
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(block.hit_rate || 0) * 100}%` }} transition={{ delay: 0.3 + i * 0.03, duration: 0.5 }}
                        className={`h-full ${barColor(block.hit_rate || 0)}`} />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {weeks.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="panel p-6">
            <h4 className="panel-title mb-1">Week by week</h4>
            <p className="panel-subtitle mb-4">Drift shows up here first</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
                  <th className="text-left py-2">Week</th>
                  <th className="text-right py-2">Picks</th>
                  <th className="text-right py-2">Hit rate</th>
                  <th className="text-right py-2">Units</th>
                  <th className="text-right py-2">Leans</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map(([week, s]) => {
                  const r = s.recommendations || { n: 0 };
                  const l = s.leans || { n: 0 };
                  return (
                    <tr key={week} className="border-b border-slate-800/80">
                      <td className="py-2 text-slate-300">{week.replace('-W', ' · wk ')}</td>
                      <td className="py-2 text-right text-slate-300 tabular-nums">{r.n ? `${r.hits}-${r.n - r.hits}` : '-'}</td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${rateColor(r.hit_rate, r.n)}`}>{r.n ? pct(r.hit_rate) : '-'}</td>
                      <td className={`py-2 text-right tabular-nums ${unitsColor(r.units)}`}>{r.bets ? signed(r.units) : '-'}</td>
                      <td className={`py-2 text-right tabular-nums ${rateColor(l.hit_rate, l.n)}`}>{l.n ? `${pct(l.hit_rate, 0)} (${l.n})` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}

        {bins.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="panel p-6">
            <h4 className="panel-title mb-1">Said vs happened</h4>
            <p className="panel-subtitle mb-4">Stated over probability against how often the over actually hit</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
                  <th className="text-left py-2">Model said</th>
                  <th className="text-right py-2">Over hit</th>
                  <th className="text-right py-2">Props</th>
                </tr>
              </thead>
              <tbody>
                {bins.map(([bin, v]) => {
                  const gap = v.actual_over - v.stated_over;
                  return (
                    <tr key={bin} className="border-b border-slate-800/80">
                      <td className="py-2 text-slate-300">{bin}%</td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${Math.abs(gap) <= 0.05 ? 'text-emerald-400' : Math.abs(gap) <= 0.1 ? 'text-amber-400' : 'text-rose-400'}`}>{pct(v.actual_over, 0)}</td>
                      <td className="py-2 text-right text-slate-400 tabular-nums">{v.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}
      </div>

      {recent.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="panel p-6">
          <h4 className="panel-title mb-1">Recent graded props</h4>
          <p className="panel-subtitle mb-4">Picks are highlighted; leans are shown for the record · CLV is the side's no-vig price gain by the close, in points</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
                  <th className="text-left py-2 px-2">Result</th>
                  <th className="text-left py-2 px-2">Player</th>
                  <th className="text-left py-2 px-2">Prop</th>
                  <th className="text-right py-2 px-2">Line</th>
                  <th className="text-right py-2 px-2">Side</th>
                  <th className="text-right py-2 px-2">Prob</th>
                  <th className="text-right py-2 px-2">Actual</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">Units</th>
                  <th className="text-right py-2 px-2">CLV</th>
                  <th className="text-left py-2 px-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <motion.tr key={r.id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.015 }}
                    className={`border-b border-slate-800/80 hover:bg-slate-800/40 transition-colors ${r.pick ? 'bg-amber-400/5' : ''}`}>
                    <td className="py-2 px-2"><ResultBadge result={r.result} /></td>
                    <td className="py-2 px-2 text-white font-medium whitespace-nowrap">
                      {r.player}{r.pick && <Zap size={12} className="inline ml-1 text-amber-400" />}
                      {r.opponent && <span className="text-slate-500 text-xs ml-1">vs {r.opponent}</span>}
                    </td>
                    <td className="py-2 px-2 text-slate-300">{propLabel(r.prop)}</td>
                    <td className="py-2 px-2 text-right text-slate-300 tabular-nums">{r.line?.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right font-semibold">
                      {r.side ? (
                        <span className={`inline-flex items-center justify-end gap-1 ${r.side === 'OVER' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.side === 'OVER' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                          {r.side === 'OVER' ? 'O' : 'U'} {r.projection?.toFixed(1)}
                          {!r.pick && <span className="text-[10px] font-normal text-slate-500 ml-1">lean</span>}
                        </span>
                      ) : <span className="text-slate-500">-</span>}
                    </td>
                    <td className={`py-2 px-2 text-right text-xs font-medium tabular-nums ${r.prob >= 56 ? 'text-emerald-400' : r.prob >= 52.4 ? 'text-amber-400' : 'text-slate-400'}`}>{r.prob != null ? `${r.prob.toFixed(0)}%` : '-'}</td>
                    <td className="py-2 px-2 text-right text-white font-semibold tabular-nums">{r.actual != null ? r.actual : '-'}</td>
                    <td className="py-2 px-2 text-right text-slate-400 text-xs whitespace-nowrap">{r.pick ? `${formatOdds(r.odds)}${r.book ? ` ${r.book}` : ''}` : '-'}</td>
                    <td className={`py-2 px-2 text-right tabular-nums text-xs ${unitsColor(r.units)}`}>{r.units != null ? signed(r.units) : '-'}</td>
                    <td className={`py-2 px-2 text-right tabular-nums text-xs whitespace-nowrap ${clvColor(r.clv_points ?? r.clv_line)}`}
                      title={r.clv_line != null ? `Line moved ${fmtClvLine(r.clv_line)} toward the pick by the close${r.beat_close != null ? r.beat_close ? ' · beat the close' : ' · did not beat the close' : ''}` : undefined}>
                      {r.clv_points != null ? `${r.clv_points > 0 ? '+' : ''}${r.clv_points.toFixed(1)}` : r.clv_line != null ? fmtClvLine(r.clv_line) : '-'}
                      {r.beat_close === true && <CheckCircle size={11} className="inline ml-1 text-emerald-400" />}
                    </td>
                    <td className="py-2 px-2 text-slate-500 text-xs whitespace-nowrap">{fmtDate(r.date)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default ModelPerformance;
