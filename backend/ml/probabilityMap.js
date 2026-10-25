/**
 * Residual -> P(over) for the edge model, shared by the prediction service and
 * the per-book best-bet scoring so every probability on the site comes from
 * one formula.
 *
 * Two map shapes are understood:
 *   legacy (edge_xgb_metadata.json probability_map):
 *     { intercept, coef_residual, coef_residual_over_line }
 *   live   (models/edge_probability_map.json, recalibrate_probability_map.py):
 *     { intercept, coef_pos, coef_neg, coef_rel_pos, coef_rel_neg }
 *     separate slopes for residuals above and below the line, fitted on this
 *     season's graded picks.
 *
 * The residual is capped at 15% of the line (at least 1) before it enters the
 * map, and the result is shrunk toward 50 by edgeProbShrink(): the model was never trained on larger disagreements, and uncapped tails
 * produced 70%+ claims that hit about 50%.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIVE_MAP_FILE = path.join(__dirname, 'models', 'edge_probability_map.json');
const CALIBRATION_FILE = path.join(__dirname, 'calibration.json');

let _shrink;
/**
 * Pooled shrink of the stated probability toward 50, measured on this
 * season's graded rows (calibration.json _edge_prob_shrink; 1 = none). The raw
 * map overstated its tails on live data, so until a refitted map validates
 * better, every probability is pulled in by the measured calibration slope.
 */
export function edgeProbShrink() {
  if (_shrink !== undefined) return _shrink;
  try {
    const v = Number(JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'))?._edge_prob_shrink?.value);
    _shrink = Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
  } catch {
    _shrink = 1;
  }
  return _shrink;
}

export function cappedResidual(residual, line) {
  const cap = Math.max(1, line * 0.15);
  return Math.max(-cap, Math.min(cap, residual));
}

/** P(over) in percent (0-100), or null when it cannot be computed. */
export function overProbabilityFromMap(map, residual, line) {
  if (!map || !Number.isFinite(residual) || !(line > 0)) return null;
  const r = cappedResidual(residual, line);
  const rel = r / line;
  let z;
  if (Number.isFinite(map.coef_pos)) {
    z = map.intercept + map.coef_pos * Math.max(r, 0) + map.coef_neg * Math.min(r, 0)
      + map.coef_rel_pos * Math.max(rel, 0) + map.coef_rel_neg * Math.min(rel, 0);
  } else {
    z = map.intercept + map.coef_residual * r + map.coef_residual_over_line * rel;
  }
  const raw = 100 / (1 + Math.exp(-z));
  return 50 + (raw - 50) * edgeProbShrink();
}

let _liveMap;
/** The live-fitted map when one has been written and validated, else null. */
export function loadLiveProbabilityMap() {
  if (_liveMap !== undefined) return _liveMap;
  try {
    const parsed = JSON.parse(fs.readFileSync(LIVE_MAP_FILE, 'utf8'));
    _liveMap = parsed && parsed.map && Number.isFinite(parsed.map.coef_pos) ? { ...parsed.map, source: 'live', fitted_at: parsed.fitted_at, fitted_on: parsed.fitted_on } : null;
    if (_liveMap) console.log(`[ProbabilityMap] using live map fitted ${parsed.fitted_at} on ${parsed.fitted_on} graded rows`);
  } catch {
    _liveMap = null;
  }
  return _liveMap;
}
