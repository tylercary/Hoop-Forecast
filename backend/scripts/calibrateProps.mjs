#!/usr/bin/env node
/**
 * Fit per-prop calibration from evaluated predictions.
 *
 *   node backend/scripts/calibrateProps.mjs [--in FILE] [--write] [--min N]
 *
 * Input: a file with { predictions: [...] } in predictionTrackingService's raw
 * format (backend/data/predictions.json, or an export from pullPredictions.mjs).
 *
 * For every prop it measures, on predictions that had a betting line:
 *   - how often the final pick (projection vs line) was right
 *   - whether the model's deviation from the line carries signal, by bucket
 *   - the anchor weight that would have minimised error vs the actual result
 *   - how well the stated over probability matched reality (calibration slope)
 * and derives { anchor_weight, prob_shrink } per prop. With --write it updates
 * backend/ml/calibration.json; otherwise it only prints the report.
 *
 * The pre-anchor value is stored directly on new predictions; for older ones it
 * is reconstructed from the stored projection and the anchor weight in force at
 * the time (0.15, unless the 10%-of-line cap was hit, in which case the record
 * is skipped for the anchor fit).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const WRITE = args.includes('--write');
const MIN_N = parseInt(opt('--min', '300'), 10);
const IN = opt('--in', fs.existsSync(path.join(__dirname, '../data/predictions_export.json'))
  ? path.join(__dirname, '../data/predictions_export.json')
  : path.join(__dirname, '../data/predictions.json'));
const CAL_FILE = path.join(__dirname, '../ml/calibration.json');
const LEGACY_ANCHOR = 0.15;
// The fitted values describe the OLD model's track record; the fallback path
// keeps a small floor so a freshly retrained model is not silenced entirely
// before it has its own evaluated history.
const ANCHOR_FLOOR = 0.05;
const SHRINK_FLOOR = 0.2;
const PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const preds = (raw.predictions || raw).filter(p =>
  p.evaluated && !p.expired && !p.dnp &&
  p.actual_value != null && p.betting_line != null && p.betting_line > 0 &&
  (p.predicted_value ?? p.predicted_points) != null
);
console.log(`Loaded ${preds.length} evaluated predictions with a line from ${path.relative(process.cwd(), IN)}`);

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const pct = (x) => `${(100 * x).toFixed(1)}%`;

/** Least-squares slope through the origin of y on x, clipped to [0, 1]. */
function fitSlope(xs, ys) {
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += xs[i] * ys[i]; den += xs[i] * xs[i]; }
  if (den === 0) return null;
  return Math.max(0, Math.min(1, num / den));
}

/** Slope of actual outcome on stated probability (both centred at 50%). */
function fitProbSlope(probs, outcomes) {
  const xs = probs.map(p => p / 100 - 0.5);
  const ys = outcomes.map((o, i) => o - 0.5);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += xs[i] * ys[i]; den += xs[i] * xs[i]; }
  if (den === 0) return null;
  return num / den;
}

const calibration = fs.existsSync(CAL_FILE) ? JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')) : {};
const report = {};

for (const prop of PROPS) {
  const rows = preds.filter(p => (p.prop_type || 'points') === prop);
  if (rows.length === 0) continue;

  const line = (p) => p.betting_line;
  const proj = (p) => p.predicted_value ?? p.predicted_points;
  const actual = (p) => p.actual_value;
  const over = (p) => actual(p) > line(p) ? 1 : actual(p) < line(p) ? 0 : null;

  // Pick accuracy of the final projection (pushes excluded)
  const decided = rows.filter(p => proj(p) !== line(p) && over(p) !== null);
  const pickHit = mean(decided.map(p => ((proj(p) > line(p)) === (actual(p) > line(p))) ? 1 : 0));
  const recs = decided.filter(p => p.recommendation === 'OVER' || p.recommendation === 'UNDER');
  const recHit = recs.length ? mean(recs.map(p => ((p.recommendation === 'OVER') === (actual(p) > line(p))) ? 1 : 0)) : null;
  const overRate = mean(rows.filter(p => over(p) !== null).map(over));

  // Pre-anchor deviation from the line
  const withDev = [];
  for (const p of rows) {
    let pre = p.pre_anchor_value;
    if (pre == null) {
      const w = p.anchor_weight ?? LEGACY_ANCHOR;
      const adj = proj(p) - line(p);
      if (Math.abs(adj) >= line(p) * 0.10 - 1e-9) continue; // capped: deviation unknown
      pre = line(p) + adj / w;
    }
    withDev.push({ dev: pre - line(p), resid: actual(p) - line(p), rel: (pre - line(p)) / line(p), overOut: over(p) });
  }
  const anchorFit = fitSlope(withDev.map(r => r.dev), withDev.map(r => r.resid));

  // Directional signal by size of the model's deviation
  const buckets = { '<3%': [], '3-7%': [], '7-15%': [], '>15%': [] };
  for (const r of withDev) {
    if (r.overOut === null || r.dev === 0) continue;
    const a = Math.abs(r.rel);
    const key = a < 0.03 ? '<3%' : a < 0.07 ? '3-7%' : a < 0.15 ? '7-15%' : '>15%';
    buckets[key].push(((r.dev > 0) === (r.overOut === 1)) ? 1 : 0);
  }

  // Probability calibration: slope of outcome on stated over probability
  const withProb = rows.filter(p => p.over_probability != null && over(p) !== null);
  const probSlope = withProb.length >= MIN_N ? fitProbSlope(withProb.map(p => p.over_probability), withProb.map(over)) : null;
  const probBuckets = {};
  for (const p of withProb) {
    const b = `${Math.floor(p.over_probability / 10) * 10}s`;
    (probBuckets[b] ||= []).push(over(p));
  }

  const enough = rows.length >= MIN_N;
  const current = calibration[prop] || calibration._default || { anchor_weight: LEGACY_ANCHOR, prob_shrink: 1 };
  const anchorWeight = enough && anchorFit != null ? Math.round(Math.max(ANCHOR_FLOOR, anchorFit) * 100) / 100 : current.anchor_weight;
  // Shrink so stated probabilities match observed frequencies, never amplifying
  const probShrink = probSlope != null ? Math.round(Math.max(SHRINK_FLOOR, Math.min(1, probSlope)) * 100) / 100 : current.prob_shrink;

  report[prop] = { n: rows.length, pickHit, recN: recs.length, recHit, overRate, anchorFit, probSlope, anchorWeight, probShrink };
  console.log(`\n${prop.toUpperCase()}  n=${rows.length}  line-over rate ${pct(overRate)}`);
  console.log(`  final pick right ${pct(pickHit)} (${decided.length}); recommendations ${recs.length} right ${recHit == null ? '-' : pct(recHit)}`);
  console.log(`  direction by model deviation: ${Object.entries(buckets).map(([k, v]) => `${k} ${v.length ? pct(mean(v)) : '-'} (${v.length})`).join(' | ')}`);
  console.log(`  anchor weight that fits actuals: ${anchorFit == null ? '-' : anchorFit.toFixed(2)} (on ${withDev.length}); current ${current.anchor_weight}`);
  console.log(`  prob calibration slope: ${probSlope == null ? '-' : probSlope.toFixed(2)}  by stated prob: ${Object.entries(probBuckets).sort().map(([k, v]) => `${k} ${pct(mean(v))} (${v.length})`).join(' | ')}`);
  console.log(`  -> anchor_weight ${anchorWeight}, prob_shrink ${probShrink}${enough ? '' : '  (too few rows, keeping current)'}`);
  calibration[prop] = { anchor_weight: anchorWeight, prob_shrink: probShrink, fitted_on: rows.length, fitted_at: new Date().toISOString().slice(0, 10) };
}

if (WRITE) {
  calibration._comment = calibration._comment || 'Per-prop calibration applied in finalizePrediction. Regenerate with: node backend/scripts/calibrateProps.mjs --write';
  calibration._default = calibration._default || { anchor_weight: LEGACY_ANCHOR, prob_shrink: 1.0 };
  fs.writeFileSync(CAL_FILE, JSON.stringify(calibration, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), CAL_FILE)}`);
} else {
  console.log('\n(dry run; pass --write to update backend/ml/calibration.json)');
}
