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
 *   - closing line value (clv) for every row with a `closing` snapshot
 *     (closingLineService), graded or not: line CLV (closing line minus the
 *     pick-time line, signed so positive means the market moved toward the
 *     pick), price CLV in no-vig probability points for the pick's side, and
 *     whether the pick beat the close (its side's closing no-vig probability
 *     is above the implied probability of the price it was shown at). Pick-time
 *     values come from the record's `market` / `best_bet`, or from
 *     `first_prediction` when the record was revised, so CLV is measured from
 *     the first time the pick was shown.
 */

import { americanToProb } from './marketFeatureService.js';
import { PICK_OVER, PICK_UNDER } from '../config/pickThresholds.js';
import { MODEL_VERSION } from '../config/modelVersion.js';

export const PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
export { PICK_OVER, PICK_UNDER };

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

/** Version stamp of a record; rows stored before versions were recorded are 'unversioned'. */
function versionOf(p) {
  return p.model_version || 'unversioned';
}

/**
 * Whether a record belongs to the version being graded.
 * 'current' = MODEL_VERSION (what the site runs now), 'all' = every version,
 * anything else = that exact stamp.
 */
function inVersion(p, version) {
  if (!version || version === 'all') return true;
  const want = version === 'current' ? MODEL_VERSION : version;
  return versionOf(p) === want;
}

/** YYYY-MM-DD from an ISO string or a display date such as "Mar 28, 2026". */
function isoDate(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Records eligible for grading, normalised to the fields the grader needs.
 * One row per player + prop + game: an export can still hold a legacy-dated
 * duplicate of a record (see predictionTrackingService.dedupeGamePredictions),
 * and the newest graded record is the one that counts.
 */
export function eligibleRows(predictions, variant = 'edge', version = 'all') {
  const rows = [];
  const seen = new Map(); // player|prop|date -> index in rows
  const stamp = (p) => new Date(p.updated_at || p.created_at || 0).getTime();
  for (const p of predictions) {
    if (!p.evaluated || p.expired || p.dnp) continue;
    if (p.actual_value == null || p.betting_line == null || !(p.betting_line > 0)) continue;
    if (variant !== 'all' && variantOf(p) !== variant) continue;
    if (!inVersion(p, version)) continue;
    const proj = p.predicted_value ?? p.predicted_points;
    const line = p.betting_line;
    const actual = p.actual_value;
    const date = isoDate(p.next_game && p.next_game.date) || isoDate(p.created_at) || '';
    const key = `${(p.player_name || '').toLowerCase()}|${p.prop_type || 'points'}|${date}`;
    if (seen.has(key)) {
      const i = seen.get(key);
      if (stamp(p) <= rows[i]._stamp) continue;
      rows.splice(i, 1);
      for (const [k, v] of seen) if (v > i) seen.set(k, v - 1);
      seen.delete(key);
    }
    seen.set(key, rows.length);
    rows.push({
      _stamp: stamp(p),
      id: p.id,
      player: p.player_name || null,
      opponent: p.next_game?.opponent || p.opponent || null,
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
      confidence: p.confidence || null,
      // Price the pick could have been taken at (best book when stored, else -110)
      odds: p.best_bet && (p.best_bet.side || '').toUpperCase() === p.recommendation && Number.isFinite(Number(p.best_bet.odds))
        ? Number(p.best_bet.odds) : -110,
      book: p.best_bet && (p.best_bet.side || '').toUpperCase() === p.recommendation ? (p.best_bet.bookmaker || null) : null,
      variant: variantOf(p),
      version: versionOf(p),
      // The first prediction ever shown for this game (before any line move or
      // re-prediction), graded against ITS line, so the record also answers
      // "what if I bet it when it first appeared"
      first: firstShown(p, line, proj),
    });
  }
  return rows;
}

function firstShown(p, finalLine, finalProj) {
  const f = p.first_prediction;
  const line = f && f.betting_line > 0 ? Number(f.betting_line) : finalLine;
  const proj = f && f.predicted_value != null ? f.predicted_value : finalProj;
  const rec = f ? (f.recommendation === 'OVER' || f.recommendation === 'UNDER' ? f.recommendation : null)
    : (p.recommendation === 'OVER' || p.recommendation === 'UNDER' ? p.recommendation : null);
  const side = rec || (proj != null && proj !== line ? (proj > line ? 'OVER' : 'UNDER') : null);
  const actual = p.actual_value;
  return {
    line, proj, rec, side,
    prob: f && typeof f.over_probability === 'number' ? f.over_probability : (typeof p.over_probability === 'number' ? p.over_probability : null),
    over: actual == null || line == null ? null : actual > line ? 1 : actual < line ? 0 : null,
    revised: !!f,
  };
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
  // With every stated probability within a couple of points of 50 the slope is
  // noise (a 0.5-point spread leverages tiny outcome differences into huge
  // numbers), so it is only reported once the probabilities actually spread
  if (Math.sqrt(den / n) < 0.02) return null;
  return num / den;
}

/** Profit on a 1-unit stake at American odds, or -1 on a loss. */
function unitsFor(won, odds) {
  if (won == null) return 0; // push
  if (!won) return -1;
  const o = Number(odds) || -110;
  return o > 0 ? o / 100 : 100 / -o;
}

/** Units won and ROI for a set of recommendation rows (pushes return the stake). */
function roiBlock(recRows) {
  const staked = recRows.length;
  const units = recRows.reduce((s, r) => s + unitsFor(r.over == null ? null : ((r.rec === 'OVER') === (r.over === 1)), r.odds), 0);
  return { bets: staked, units: round(units, 2), roi: staked ? round(units / staked) : null };
}

function hitBlock(pairs) {
  // pairs: [predictedOver(0/1), actualOver(0/1)]
  const n = pairs.length;
  const hits = pairs.filter(([a, b]) => a === b).length;
  return { n, hits, hit_rate: n ? round(hits / n) : null };
}

/** No-vig over probability the closing snapshot recorded at a line, or null. */
function closingOverProbAt(closing, line) {
  if (!closing || !(line > 0)) return null;
  const hit = (closing.lines || []).find(l => Math.abs(Number(l.line) - line) < 0.01);
  if (hit && hit.over_prob_novig != null) return hit.over_prob_novig;
  if (Math.abs(Number(closing.line) - line) < 0.01) return closing.over_prob_novig ?? null;
  return null;
}

/**
 * Closing line value for one record, or null without a usable snapshot.
 * @returns {{ side, pick, clv_line, clv_points, beat_close, pick_line, close_line, odds }|null}
 */
export function closingLineValue(p) {
  const closing = p.closing;
  if (!closing || !(closing.line > 0)) return null;
  const rec = p.recommendation === 'OVER' || p.recommendation === 'UNDER' ? p.recommendation : null;
  // Measure from the first time this side was shown: the first prediction when
  // the record was revised and the pick did not change, else the record itself
  const first = p.first_prediction;
  const useFirst = first && first.betting_line > 0 &&
    ((first.recommendation === 'OVER' || first.recommendation === 'UNDER' ? first.recommendation : null) === rec);
  const pickLine = Number(useFirst ? first.betting_line : p.betting_line);
  if (!(pickLine > 0)) return null;
  const proj = p.predicted_value ?? p.predicted_points;
  const side = rec || (proj != null && proj !== pickLine ? (proj > pickLine ? 'OVER' : 'UNDER') : null);
  if (!side) return null;
  const market = useFirst
    ? (first.market || (Math.abs(Number(p.market?.line) - pickLine) < 0.01 ? p.market : null))
    : p.market;
  const bestBet = useFirst ? (first.best_bet ?? (first.market ? null : p.best_bet)) : p.best_bet;

  const closeLine = Number(closing.line);
  const clvLine = side === 'OVER' ? closeLine - pickLine : pickLine - closeLine;

  // Price CLV: the side's no-vig probability at the pick line, close vs pick time
  const sideProb = (overProb) => (overProb == null ? null : side === 'OVER' ? overProb : 1 - overProb);
  const pickNoVig = market && Math.abs(Number(market.line) - pickLine) < 0.01 ? sideProb(market.over_prob_novig) : null;
  const closeNoVigAtPick = sideProb(closingOverProbAt(closing, pickLine));
  const clvPoints = pickNoVig != null && closeNoVigAtPick != null ? (closeNoVigAtPick - pickNoVig) * 100 : null;

  // Beat the close: the price shown (best book at its line when stored, else the
  // consensus price at the pick line) against the closing fair price at that line
  let odds = null, oddsLine = pickLine;
  if (bestBet && (bestBet.side || '').toUpperCase() === side && Number.isFinite(Number(bestBet.odds)) && bestBet.line > 0) {
    odds = Number(bestBet.odds); oddsLine = Number(bestBet.line);
  } else if (market && Math.abs(Number(market.line) - pickLine) < 0.01) {
    odds = side === 'OVER' ? market.over_odds : market.under_odds;
  }
  const implied = americanToProb(odds);
  const closeNoVigAtOdds = sideProb(closingOverProbAt(closing, oddsLine));
  const beatClose = implied != null && closeNoVigAtOdds != null ? closeNoVigAtOdds > implied : null;

  return {
    side, pick: !!rec,
    clv_line: round(clvLine, 2),
    clv_points: round(clvPoints, 2),
    beat_close: beatClose,
    pick_line: pickLine, close_line: closeLine, odds
  };
}

/** Rows with a closing snapshot (graded or not), for CLV. */
export function clvRows(predictions, variant = 'edge', version = 'all') {
  const rows = [];
  for (const p of predictions) {
    if (p.expired || p.dnp || !p.closing) continue;
    if (variant !== 'all' && variantOf(p) !== variant) continue;
    if (!inVersion(p, version)) continue;
    const clv = closingLineValue(p);
    if (!clv) continue;
    const date = isoDate(p.next_game && p.next_game.date) || isoDate(p.created_at) || '';
    rows.push({ id: p.id, prop: p.prop_type || 'points', date, week: isoWeek(date), evaluated: !!p.evaluated, ...clv });
  }
  return rows;
}

function clvSideBlock(rows) {
  const withLine = rows.filter(r => r.clv_line != null);
  const withPoints = rows.filter(r => r.clv_points != null);
  const withBeat = rows.filter(r => r.beat_close != null);
  return {
    n: rows.length,
    n_priced: withPoints.length,
    mean_line: round(mean(withLine.map(r => r.clv_line)), 3),
    mean_points: round(mean(withPoints.map(r => r.clv_points)), 2),
    beat_close: withBeat.length ? round(withBeat.filter(r => r.beat_close).length / withBeat.length) : null,
    beat_close_n: withBeat.length,
  };
}

/** CLV block for a slice: picks and leans separately, plus the row count. */
export function clvBlock(rows) {
  return {
    n: rows.length,
    graded: rows.filter(r => r.evaluated).length,
    picks: clvSideBlock(rows.filter(r => r.pick)),
    leans: clvSideBlock(rows.filter(r => !r.pick)),
  };
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
    ...roiBlock(rows.filter(r => r.rec)),
  };
  // Same record, graded as it was FIRST shown (its own line and side)
  const firstRecs = rows.filter(r => r.first?.rec && r.first.over != null);
  const firstPairs = firstRecs.map(r => [r.first.rec === 'OVER' ? 1 : 0, r.first.over]);
  const finalSide = (r) => r.rec || (r.proj != null && r.proj !== r.line ? (r.proj > r.line ? 'OVER' : 'UNDER') : null);
  const sideChanged = rows.filter(r => r.first?.side && finalSide(r) && r.first.side !== finalSide(r));
  const firstPick = {
    ...hitBlock(firstPairs),
    over: hitBlock(firstPairs.filter(([a]) => a === 1)),
    under: hitBlock(firstPairs.filter(([a]) => a === 0)),
    revised_rows: rows.filter(r => r.first?.revised).length,
    side_changed: sideChanged.length,
    line_moved: rows.filter(r => r.first?.revised && r.first.line !== r.line).length,
  };
  const byConfidence = {};
  for (const tier of ['High', 'Medium', 'Low']) {
    const sub = recs.filter(r => r.confidence === tier);
    if (sub.length) byConfidence[tier] = { ...hitBlock(sub.map(r => [r.rec === 'OVER' ? 1 : 0, r.over])), ...roiBlock(rows.filter(r => r.rec && r.confidence === tier)) };
  }

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
    first_pick: firstPick,
    by_confidence: byConfidence,
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
 * @param {{variant?: string, version?: string}} opts
 *   version: 'all' (default, every version), 'current' (MODEL_VERSION only:
 *   what the site shows), or an exact version stamp. With a version filter the
 *   summary also carries `other_versions`: the pick and lean record of every
 *   version left out, so the opening-week model stays visible but apart.
 */
export function gradeEdgePredictions(predictions, { variant = 'edge', version = 'all' } = {}) {
  const rows = eligibleRows(predictions, variant, version);
  const clv = clvRows(predictions, variant, version);
  const clvById = new Map(clv.map(r => [r.id, r]));
  const byProp = {};
  for (const prop of PROPS) {
    const sub = rows.filter(r => r.prop === prop);
    const subClv = clv.filter(r => r.prop === prop);
    if (sub.length || subClv.length) byProp[prop] = { ...summarize(sub), clv: clvBlock(subClv) };
  }
  const weeks = [...new Set([...rows, ...clv].map(r => r.week).filter(Boolean))].sort();
  const byWeek = {};
  for (const w of weeks) byWeek[w] = { ...summarize(rows.filter(r => r.week === w)), clv: clvBlock(clv.filter(r => r.week === w)) };

  const variants = {};
  const versions = {};
  for (const p of predictions) {
    if (!p.evaluated || p.actual_value == null || p.betting_line == null) continue;
    const v = variantOf(p);
    variants[v] = (variants[v] || 0) + 1;
    if (variant === 'all' || v === variant) versions[versionOf(p)] = (versions[versionOf(p)] || 0) + 1;
  }
  // Versions not being graded: a compact record each, so they stay on view
  // without mixing into the current model's numbers
  const otherVersions = {};
  if (version !== 'all') {
    const allRows = eligibleRows(predictions, variant, 'all');
    for (const v of Object.keys(versions).sort()) {
      if (v === (version === 'current' ? MODEL_VERSION : version)) continue;
      const sub = allRows.filter(r => r.version === v);
      if (!sub.length) continue;
      const s = summarize(sub);
      otherVersions[v] = {
        n: s.n, date_range: s.date_range,
        picks: { n: s.recommendations.n, hits: s.recommendations.hits, hit_rate: s.recommendations.hit_rate, units: s.recommendations.units },
        leans: { n: s.leans.n, hits: s.leans.hits, hit_rate: s.leans.hit_rate },
        calibration_slope: s.calibration_slope,
      };
    }
  }
  // Still waiting on a result (the current model only)
  const pending = predictions.filter(p => !p.evaluated && (variant === 'all' || variantOf(p) === variant) && inVersion(p, version));
  const pendingPicks = pending.filter(p => p.recommendation === 'OVER' || p.recommendation === 'UNDER');
  const nextTip = pending.map(p => p.next_game?.commence_time).filter(Boolean).sort()[0] || null;

  // Latest graded rows, newest game first, picks before leans within a day
  const recent = [...rows]
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.rec ? 1 : 0) - (a.rec ? 1 : 0))
    .slice(0, 40)
    .map(r => {
      const side = r.rec ? r.rec : (r.proj != null && r.proj !== r.line ? (r.proj > r.line ? 'OVER' : 'UNDER') : null);
      const won = r.over == null ? null : side == null ? null : (side === 'OVER') === (r.over === 1);
      return {
        id: r.id, player: r.player, opponent: r.opponent, prop: r.prop, date: r.date, line: r.line,
        side, pick: !!r.rec, prob: r.prob == null ? null : (side === 'UNDER' ? round(100 - r.prob, 1) : round(r.prob, 1)),
        projection: r.proj, actual: r.actual, result: r.over == null ? 'push' : won ? 'hit' : 'miss',
        confidence: r.confidence, odds: r.rec ? r.odds : null, book: r.rec ? r.book : null,
        first_side: r.first?.side || null, first_line: r.first?.line ?? null, first_pick: !!r.first?.rec,
        first_result: r.first?.side && r.first.over != null ? ((r.first.side === 'OVER') === (r.first.over === 1) ? 'hit' : 'miss') : null,
        side_changed: !!(r.first?.side && side && r.first.side !== side),
        units: r.rec ? round(unitsFor(won, r.odds), 2) : null,
        clv_line: clvById.get(r.id)?.clv_line ?? null,
        clv_points: clvById.get(r.id)?.clv_points ?? null,
        beat_close: clvById.get(r.id)?.beat_close ?? null,
      };
    });

  return {
    generated_at: new Date().toISOString(),
    variant,
    version,
    model_version: MODEL_VERSION,
    thresholds: { over: PICK_OVER, under: PICK_UNDER },
    evaluated_by_variant: variants,
    evaluated_by_version: versions,
    other_versions: otherVersions,
    pending: { n: pending.length, picks: pendingPicks.length, next_tip: nextTip },
    overall: { ...summarize(rows), clv: clvBlock(clv) },
    by_prop: byProp,
    by_week: byWeek,
    recent,
  };
}

/** Compact lines for a console report. */
export function formatGradingReport(summary) {
  const pct = (x) => (x == null ? '   -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
  const num = (x, d = 3) => (x == null ? '-' : x.toFixed(d));
  const lines = [];
  const o = summary.overall;
  lines.push(`Edge model grading  (variant=${summary.variant}, version=${summary.version || 'all'}, generated ${summary.generated_at.slice(0, 16).replace('T', ' ')} UTC)`);
  lines.push(`Evaluated records with a line, by variant: ${Object.entries(summary.evaluated_by_variant).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (summary.evaluated_by_version) lines.push(`By model version: ${Object.entries(summary.evaluated_by_version).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}  (running: ${summary.model_version})`);
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
  const c = o.clv;
  if (c && c.n) {
    const pts = (x) => (x == null ? '-' : `${x > 0 ? '+' : ''}${x.toFixed(2)}`);
    lines.push('');
    lines.push(`Closing line value (${c.n} snapshots, ${c.graded} graded): picks n=${c.picks.n} line ${pts(c.picks.mean_line)} price ${pts(c.picks.mean_points)}pts beat-close ${pct(c.picks.beat_close)} | leans n=${c.leans.n} line ${pts(c.leans.mean_line)} price ${pts(c.leans.mean_points)}pts beat-close ${pct(c.leans.beat_close)}`);
  }
  lines.push('');
  lines.push('By ISO week (game date):');
  for (const [w, s] of Object.entries(summary.by_week)) lines.push(row(w, s));
  return lines.join('\n');
}
