/**
 * Grading of the edge model's live track record.
 *
 * Shared by backend/scripts/gradeEdgeModel.mjs (offline, from an export) and
 * GET /api/performance/edge (from the in-memory store). Both produce the same
 * summary shape so numbers in the report and on the site cannot drift apart.
 *
 * Only predictions that are evaluated with an actual value and a betting line
 * are graded. By default only model_variant === 'edge' records count; the
 * variant can be widened for comparison ('anchored', 'legacy' for records
 * stored before the variant was recorded, or 'all').
 *
 * For each slice (overall, per prop, per ISO week of the game date) it reports:
 *   - realised over rate of the line (the base rate every number is judged against)
 *   - hit rate of OVER/UNDER recommendations, overall and per side (pushes excluded)
 *   - stated over probability vs realised over rate, in the pick buckets the
 *     server uses (<=44 UNDER, 44-56 lean, >=56 OVER) and in 5-point bins
 *   - leans (no recommendation): how often the actual landed on the projection's
 *     side of the line, per side
 *   - calibration slope of outcome on stated probability (1 = calibrated,
 *     <1 = overconfident), as in backend/scripts/calibrateProps.mjs
 *   - log loss and Brier score of the stated probability
 */

export const PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
export const PICK_OVER = 56;
export const PICK_UNDER = 44;

const round = (x, d = 4) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/** ISO-8601 week label (e.g. 2026-W15) for a YYYY-MM-DD string. */
export function isoWeek(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7; // Monday=1 .. Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function variantOf(p) {
  return p.model_variant || 'legacy';
}

/** YYYY-MM-DD from an ISO string or a display date such as "Mar 28, 2026". */
function isoDate(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Records eligible for grading, normalised to the fields the grader needs. */
export function eligibleRows(predictions, variant = 'edge') {
  const rows = [];
  for (const p of predictions) {
    if (!p.evaluated || p.expired || p.dnp) continue;
    if (p.actual_value == null || p.betting_line == null || !(p.betting_line > 0)) continue;
    if (variant !== 'all' && variantOf(p) !== variant) continue;
    const proj = p.predicted_value ?? p.predicted_points;
    const line = p.betting_line;
    const actual = p.actual_value;
    const date = isoDate(p.next_game && p.next_game.date) || isoDate(p.created_at) || '';
    rows.push({
      prop: p.prop_type || 'points',
      date,
      week: isoWeek(date),
      line,
      actual,
      proj,
      over: actual > line ? 1 : actual < line ? 0 : null, // null = push
      rec: p.recommendation === 'OVER' || p.recommendation === 'UNDER' ? p.recommendation : null,
      prob: typeof p.over_probability === 'number' ? p.over_probability : null,
      residual: typeof p.edge_residual === 'number' ? p.edge_residual : null,
      variant: variantOf(p),
    });
  }
  return rows;
}

/** Slope of outcome on stated probability, both centred at 50% (calibrateProps.mjs). */
export function calibrationSlope(rows) {
  let num = 0, den = 0, n = 0;
  for (const r of rows) {
    if (r.prob == null || r.over == null) continue;
    const x = r.prob / 100 - 0.5;
    const y = r.over - 0.5;
    num += x * y; den += x * x; n++;
  }
  if (n < 30 || den === 0) return null;
  return num / den;
}

function hitBlock(pairs) {
  // pairs: [predictedOver(0/1), actualOver(0/1)]
  const n = pairs.length;
  const hits = pairs.filter(([a, b]) => a === b).length;
  return { n, hits, hit_rate: n ? round(hits / n) : null };
}

/** One grading block for a set of rows. */
export function summarize(rows) {
  const decided = rows.filter(r => r.over != null);
  const pushes = rows.length - decided.length;

  const recs = decided.filter(r => r.rec);
  const recPairs = recs.map(r => [r.rec === 'OVER' ? 1 : 0, r.over]);
  const recommendations = {
    ...hitBlock(recPairs),
    pushes: rows.filter(r => r.rec && r.over == null).length,
    over: hitBlock(recPairs.filter(([a]) => a === 1)),
    under: hitBlock(recPairs.filter(([a]) => a === 0)),
  };

  // Leans: no pick; the UI shows the projection's side of the line
  const leans = decided.filter(r => !r.rec && r.proj != null && r.proj !== r.line);
  const leanPairs = leans.map(r => [r.proj > r.line ? 1 : 0, r.over]);
  const leanBlock = {
    ...hitBlock(leanPairs),
    over_side: hitBlock(leanPairs.filter(([a]) => a === 1)),
    under_side: hitBlock(leanPairs.filter(([a]) => a === 0)),
  };

  // Stated probability vs realised over rate
  const withProb = decided.filter(r => r.prob != null);
  const bucketOf = (p) => (p <= PICK_UNDER ? `<=${PICK_UNDER}` : p >= PICK_OVER ? `>=${PICK_OVER}` : `${PICK_UNDER}-${PICK_OVER}`);
  const probBuckets = {};
  const probBins = {};
  for (const r of withProb) {
    const b = bucketOf(r.prob);
    (probBuckets[b] ||= { n: 0, stated: [], over: [] });
    probBuckets[b].n++; probBuckets[b].stated.push(r.prob); probBuckets[b].over.push(r.over);
    const lo = Math.min(95, Math.max(0, Math.floor(r.prob / 5) * 5));
    const k = `${lo}-${lo + 5}`;
    (probBins[k] ||= { n: 0, stated: [], over: [] });
    probBins[k].n++; probBins[k].stated.push(r.prob); probBins[k].over.push(r.over);
  }
  const finish = (obj) => Object.fromEntries(Object.entries(obj)
    .sort(([a], [b]) => parseFloat(a.replace(/[<>=]/g, '')) - parseFloat(b.replace(/[<>=]/g, '')))
    .map(([k, v]) => [k, { n: v.n, stated_over: round(mean(v.stated) / 100), actual_over: round(mean(v.over)) }]));

  let logLoss = null, brier = null;
  if (withProb.length) {
    const eps = 1e-6;
    logLoss = mean(withProb.map(r => {
      const p = Math.min(1 - eps, Math.max(eps, r.prob / 100));
      return -(r.over * Math.log(p) + (1 - r.over) * Math.log(1 - p));
    }));
    brier = mean(withProb.map(r => (r.prob / 100 - r.over) ** 2));
  }

  const dates = rows.map(r => r.date).filter(Boolean).sort();
  return {
    n: rows.length,
    pushes,
    date_range: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    over_rate: decided.length ? round(mean(decided.map(r => r.over))) : null,
    recommendations,
    leans: leanBlock,
    prob_buckets: finish(probBuckets),
    prob_bins: finish(probBins),
    calibration_slope: round(calibrationSlope(withProb)),
    log_loss: round(logLoss),
    brier: round(brier),
  };
}

/**
 * Full grading summary for a prediction array.
 * @param {object[]} predictions raw predictionTrackingService records
 * @param {{variant?: string}} opts
 */
export function gradeEdgePredictions(predictions, { variant = 'edge' } = {}) {
  const rows = eligibleRows(predictions, variant);
  const byProp = {};
  for (const prop of PROPS) {
    const sub = rows.filter(r => r.prop === prop);
    if (sub.length) byProp[prop] = summarize(sub);
  }
  const weeks = [...new Set(rows.map(r => r.week).filter(Boolean))].sort();
  const byWeek = {};
  for (const w of weeks) byWeek[w] = summarize(rows.filter(r => r.week === w));

  const variants = {};
  for (const p of predictions) {
    if (!p.evaluated || p.actual_value == null || p.betting_line == null) continue;
    const v = variantOf(p);
    variants[v] = (variants[v] || 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    variant,
    thresholds: { over: PICK_OVER, under: PICK_UNDER },
    evaluated_by_variant: variants,
    overall: summarize(rows),
    by_prop: byProp,
    by_week: byWeek,
  };
}

/** Compact lines for a console report. */
export function formatGradingReport(summary) {
  const pct = (x) => (x == null ? '   -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
  const num = (x, d = 3) => (x == null ? '-' : x.toFixed(d));
  const lines = [];
  const o = summary.overall;
  lines.push(`Edge model grading  (variant=${summary.variant}, generated ${summary.generated_at.slice(0, 16).replace('T', ' ')} UTC)`);
  lines.push(`Evaluated records with a line, by variant: ${Object.entries(summary.evaluated_by_variant).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (!o.n) {
    lines.push(`No evaluated '${summary.variant}' predictions with a betting line yet.`);
    return lines.join('\n');
  }
  lines.push(`Graded ${o.n} predictions (${o.pushes} pushes), games ${o.date_range[0]} .. ${o.date_range[1]}, line-over rate ${pct(o.over_rate)}`);
  lines.push('');
  const row = (label, s) => {
    const r = s.recommendations, l = s.leans;
    return `${label.padEnd(10)} ${String(s.n).padStart(6)}  ${pct(s.over_rate)}  | picks ${String(r.n).padStart(5)} ${pct(r.hit_rate)}  O ${String(r.over.n).padStart(5)} ${pct(r.over.hit_rate)}  U ${String(r.under.n).padStart(5)} ${pct(r.under.hit_rate)}  | leans ${String(l.n).padStart(5)} ${pct(l.hit_rate)}  | slope ${num(s.calibration_slope, 2).padStart(5)}  logloss ${num(s.log_loss)}`;
  };
  lines.push(`${'slice'.padEnd(10)} ${'n'.padStart(6)}  over%   | picks     hit%  OVER   n   hit%  UNDER  n   hit%  | leans   n  proj-side%  | calib        `);
  lines.push(row('ALL', o));
  for (const [prop, s] of Object.entries(summary.by_prop)) lines.push(row(prop, s));
  lines.push('');
  lines.push('Stated P(over) vs realised over rate (pick buckets):');
  for (const [k, v] of Object.entries(o.prob_buckets)) lines.push(`  ${k.padEnd(6)} n=${String(v.n).padStart(6)}  stated ${pct(v.stated_over)}  actual ${pct(v.actual_over)}`);
  lines.push('5-point bins:');
  for (const [k, v] of Object.entries(o.prob_bins)) lines.push(`  ${k.padEnd(6)} n=${String(v.n).padStart(6)}  stated ${pct(v.stated_over)}  actual ${pct(v.actual_over)}`);
  lines.push('');
  lines.push(`Leans by projection side: over-side ${o.leans.over_side.n} ${pct(o.leans.over_side.hit_rate)} | under-side ${o.leans.under_side.n} ${pct(o.leans.under_side.hit_rate)}`);
  lines.push('');
  lines.push('By ISO week (game date):');
  for (const [w, s] of Object.entries(summary.by_week)) lines.push(row(w, s));
  return lines.join('\n');
}
