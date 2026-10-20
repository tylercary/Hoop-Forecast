import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent storage — use mounted volume in production, local data/ in dev
const PREDICTIONS_DIR = process.env.DATA_DIR || join(__dirname, '../data');
const PREDICTIONS_FILE = join(PREDICTIONS_DIR, 'predictions.json');

// Ensure data directory exists
if (!fs.existsSync(PREDICTIONS_DIR)) {
  fs.mkdirSync(PREDICTIONS_DIR, { recursive: true });
}

// Map from prop type names to ML-formatted prop keys
const PROP_TYPE_FORMAT_MAP = {
  'points': 'PTS',
  'rebounds': 'REB',
  'assists': 'AST',
  'threes': '3PM',
  'threes_made': '3PM',
  'pra': 'PRA',
  'points_rebounds_assists': 'PRA',
  'pr': 'PR',
  'points_rebounds': 'PR',
  'pa': 'PA',
  'points_assists': 'PA',
  'ra': 'RA',
  'rebounds_assists': 'RA'
};

/**
 * Prediction store.
 *
 * The history lives in one JSON file (tens of MB in production). It is read
 * once into memory and every reader works on that object; writes are
 * coalesced and flushed to disk shortly afterwards, atomically (tmp + rename),
 * so a player page that stores eight props no longer re-parses and rewrites the
 * whole file eight times.
 */
let _store = null;
let _dirty = false;
let _flushTimer = null;
let _flushing = false;
const FLUSH_DELAY_MS = 2000;

function loadPredictions() {
  if (_store) return _store;
  try {
    if (fs.existsSync(PREDICTIONS_FILE)) {
      const data = fs.readFileSync(PREDICTIONS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      _store = parsed && Array.isArray(parsed.predictions) ? parsed : { predictions: [] };
      console.log(`[PredictionTracking] Loaded ${_store.predictions.length} predictions into memory`);
      return _store;
    }
  } catch (error) {
    console.error('Error loading predictions:', error);
  }
  _store = { predictions: [] };
  return _store;
}

function writeStoreToDisk(sync = false) {
  if (!_store) return;
  const payload = JSON.stringify(_store);
  const tmp = `${PREDICTIONS_FILE}.tmp`;
  if (sync) {
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, PREDICTIONS_FILE);
    return;
  }
  _flushing = true;
  fs.writeFile(tmp, payload, 'utf8', (writeErr) => {
    if (writeErr) {
      _flushing = false;
      _dirty = true;
      console.error('Error saving predictions:', writeErr);
      return;
    }
    fs.rename(tmp, PREDICTIONS_FILE, (renameErr) => {
      _flushing = false;
      if (renameErr) {
        _dirty = true;
        console.error('Error saving predictions:', renameErr);
      }
      if (_dirty) scheduleFlush();
    });
  });
}

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_flushing) { scheduleFlush(); return; }
    if (!_dirty) return;
    _dirty = false;
    writeStoreToDisk(false);
  }, FLUSH_DELAY_MS);
  if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
}

/**
 * Mark the in-memory store changed; it is written to disk shortly after.
 */
function savePredictions(data) {
  if (data && data !== _store) _store = data;
  _dirty = true;
  scheduleFlush();
}

/** Write any pending changes now (used on shutdown). */
export function flushPredictionsSync() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (!_dirty) return;
  try {
    _dirty = false;
    writeStoreToDisk(true);
  } catch (error) {
    console.error('Error flushing predictions:', error);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    flushPredictionsSync();
    process.exit(0);
  });
}
process.on('beforeExit', flushPredictionsSync);

/**
 * Move every prediction that did not come from the edge model out of the live
 * store into an archive file next to it. The Model Performance page and Best
 * Bets then describe only the current model; the archive stays available to
 * the export endpoint (source=archive) so training can still use it.
 * Idempotent: with nothing to move it writes nothing.
 */
export function archiveLegacyPredictions({ keepVariant = 'edge' } = {}) {
  const data = loadPredictions();
  const keep = [];
  const archive = [];
  for (const p of data.predictions) {
    (p.model_variant === keepVariant ? keep : archive).push(p);
  }
  if (archive.length === 0) return { archived: 0, kept: keep.length, file: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(PREDICTIONS_DIR, `predictions_archive_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({
    archived_at: new Date().toISOString(),
    reason: `records not from the '${keepVariant}' model`,
    predictions: archive
  }), 'utf8');
  data.predictions = keep;
  savePredictions(data);
  flushPredictionsSync();
  console.log(`[PredictionTracking] Archived ${archive.length} legacy predictions to ${file}; ${keep.length} kept`);
  return { archived: archive.length, kept: keep.length, file };
}

/** Archive files written by archiveLegacyPredictions, oldest first. */
export function listArchives() {
  try {
    return fs.readdirSync(PREDICTIONS_DIR)
      .filter(f => /^predictions_archive_.*\.json$/.test(f))
      .sort()
      .map(f => join(PREDICTIONS_DIR, f));
  } catch {
    return [];
  }
}

let _archiveCache = null;
/** Every archived prediction (read once per process). */
export function getArchivedPredictions() {
  if (_archiveCache) return _archiveCache;
  const all = [];
  for (const file of listArchives()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      all.push(...(parsed.predictions || []));
    } catch (error) {
      console.warn(`[PredictionTracking] Could not read archive ${file}:`, error.message);
    }
  }
  _archiveCache = all;
  return all;
}

/** Every stored prediction (live array; callers must not mutate it). */
export function getAllPredictions() {
  return loadPredictions().predictions;
}

/**
 * Raw records for export/analysis, paginated. Feature vectors are large and
 * only included on request.
 */
export function getRawPredictions({ offset = 0, limit = 1000, includeFeatures = false, evaluatedOnly = false, source = 'live' } = {}) {
  const all = source === 'archive' ? getArchivedPredictions() : loadPredictions().predictions;
  const pool = evaluatedOnly ? all.filter(p => p.evaluated && !p.expired && !p.dnp && p.actual_value != null) : all;
  const page = pool.slice(offset, offset + limit).map(p => {
    if (includeFeatures) return p;
    const { feature_vector, ...rest } = p;
    return { ...rest, has_feature_vector: !!feature_vector };
  });
  return { total: pool.length, offset, limit, source, predictions: page };
}

/**
 * Store a prediction for future evaluation
 * @param {string} playerName - Player name
 * @param {object} prediction - Prediction data
 * @param {array} gameHistory - Games used for prediction
 * @param {object} nextGameInfo - Info about the next game being predicted
 * @param {string} propType - Prop type (e.g., 'points', 'assists', 'rebounds')
 * @param {object|null} featureVector - Full ML feature vector used for prediction (for retraining)
 */
/**
 * Game dates arrive as ISO ("2026-10-20") from the batch and as "Oct 20, 2026"
 * from the player page; one record per game needs one spelling.
 */
export function normalizeGameDate(value) {
  if (!value) return null;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function storePrediction(playerName, prediction, gameHistory, nextGameInfo = {}, propType = 'points', featureVector = null) {
  const data = loadPredictions();
  const gameDate = normalizeGameDate(nextGameInfo.date);

  // One record per player + prop + game. A later prediction for the same game
  // (line moved, model retrained) REPLACES the stored numbers so everything
  // that reads the store (Best Bets, grading) sees what the player page shows;
  // the record keeps its id and created_at and counts its revisions. Once the
  // game is graded the record is frozen.
  const matches = gameDate == null ? [] : data.predictions.filter(p =>
    p.player_name?.toLowerCase() === playerName.toLowerCase() &&
    p.prop_type === propType &&
    normalizeGameDate(p.next_game?.date) === gameDate
  );
  if (matches.some(p => p.evaluated)) {
    return matches.find(p => p.evaluated).id;
  }
  // Legacy duplicates (two date spellings for one game): keep the newest
  matches.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const existing = matches[0] || null;
  for (const dup of matches.slice(1)) {
    data.predictions.splice(data.predictions.indexOf(dup), 1);
  }

  // Get the predicted value for this prop type
  const predictedValue = prediction[`predicted_${propType}`] || prediction.predicted_points || prediction.predicted_value;

  // Build a stat-key hash from the game history
  const statKey = propType === 'points' ? 'points' : (propType === 'assists' ? 'assists' : (propType === 'rebounds' ? 'rebounds' : propType));
  const hashParts = gameHistory.map(g => `${g.date}-${g[statKey] ?? g.pts ?? ''}`).join('|');

  const predictionRecord = {
    id: `pred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    player_name: playerName,
    prop_type: propType,
    predicted_value: predictedValue,
    predicted_points: propType === 'points' ? predictedValue : null, // backward compat
    confidence: prediction.confidence,
    error_margin: prediction.error_margin,
    recommendation: prediction.recommendation || null, // OVER, UNDER, or null
    betting_line: prediction.betting_line || null,
    model_value: prediction.model_value ?? null,
    pre_anchor_value: prediction.pre_anchor_value ?? null,
    anchor_weight: prediction.anchor_weight ?? null,
    edge_residual: prediction.edge_residual ?? null,
    model_variant: prediction.model_variant ?? null,
    sigma: prediction.error_margin ?? null,
    over_probability: prediction.over_probability || null,
    edge_strength: prediction.edge_strength || null,
    matchup_impact: prediction.matchup_impact || null,
    opponent: prediction.opponent || null,
    method: prediction.method || 'xgboost_model',
    stats: prediction.stats || {},
    // What the books said about the line (marketFeatureService.summarizeMarket)
    market: prediction.market || null,
    // Opponent and risk context the edge model saw (unifiedPredictionService)
    edge_context: prediction.edge_context || null,
    // Best available bet across books when the prediction was made (bestBetService);
    // the tracked predicted_value and recommendation stay the consensus-line ones
    best_bet: prediction.best_bet || null,
    game_history_hash: hashParts,
    next_game: {
      date: gameDate,
      opponent: nextGameInfo.opponent || prediction.opponent || null,
      is_home: nextGameInfo.isHome ?? null,
      team: nextGameInfo.team || null,
      commence_time: nextGameInfo.commence_time || null
    },
    feature_vector: featureVector || null, // Full ML features for retraining
    prop_type_formatted: prediction.method === 'xgboost_model' ? (PROP_TYPE_FORMAT_MAP[propType] || propType.toUpperCase()) : null,
    created_at: new Date().toISOString(),
    actual_value: null, // Will be filled when outcome is known
    actual_points: null, // backward compat
    accuracy: null,
    evaluated: false
  };

  if (existing) {
    const changed = existing.predicted_value !== predictionRecord.predicted_value ||
      existing.betting_line !== predictionRecord.betting_line ||
      existing.over_probability !== predictionRecord.over_probability ||
      existing.recommendation !== predictionRecord.recommendation;
    if (!changed) return existing.id;
    const { id, created_at, actual_value, actual_points, accuracy, evaluated } = existing;
    const revisions = (existing.revisions || 0) + 1;
    Object.assign(existing, predictionRecord, {
      id, created_at, actual_value, actual_points, accuracy, evaluated,
      next_game: { ...existing.next_game, ...predictionRecord.next_game },
      revisions,
      updated_at: new Date().toISOString(),
      first_prediction: existing.first_prediction || {
        predicted_value: existing.predicted_value,
        betting_line: existing.betting_line,
        over_probability: existing.over_probability,
        recommendation: existing.recommendation,
        at: created_at
      }
    });
    savePredictions(data);
    return existing.id;
  }

  data.predictions.push(predictionRecord);
  savePredictions(data);
  return predictionRecord.id;
}

/**
 * Update prediction with actual outcome
 * @param {string} predictionId - Prediction ID
 * @param {number} actualPoints - Actual points scored
 */
export function updatePredictionOutcome(predictionId, actualPoints) {
  const data = loadPredictions();
  const prediction = data.predictions.find(p => p.id === predictionId);
  
  if (!prediction) {
    console.warn(`⚠️ Prediction ${predictionId} not found`);
    return null;
  }
  
  prediction.actual_points = actualPoints; // backward compat
  prediction.actual_value = actualPoints;
  prediction.evaluated = true;
  prediction.evaluated_at = new Date().toISOString();

  // Calculate accuracy metrics
  const predictedVal = prediction.predicted_value ?? prediction.predicted_points;
  const error = Math.abs(predictedVal - actualPoints);
  prediction.absolute_error = error;
  prediction.percentage_error = predictedVal > 0
    ? (error / predictedVal) * 100
    : null;
  prediction.within_margin = error <= prediction.error_margin;
  prediction.within_2x_margin = error <= (prediction.error_margin * 2);
  
  // Calculate accuracy score (0-100)
  if (prediction.error_margin > 0) {
    // Accuracy based on how close to error margin (100% if exact, 0% if >2x margin)
    const normalizedError = Math.min(error / (prediction.error_margin * 2), 1);
    prediction.accuracy = Math.round((1 - normalizedError) * 100);
  } else {
    // Fallback: accuracy based on percentage error
    const pctError = prediction.percentage_error || 0;
    prediction.accuracy = Math.max(0, Math.round(100 - Math.min(pctError, 100)));
  }
  
  savePredictions(data);
  
  return prediction;
}

/**
 * Mark a prediction as DNP (player did not play)
 * Removes it from pending evaluations without counting as a hit/miss
 */
export function markPredictionDNP(predictionId) {
  const data = loadPredictions();
  const prediction = data.predictions.find(p => p.id === predictionId);
  if (!prediction) return null;

  prediction.evaluated = true;
  prediction.evaluated_at = new Date().toISOString();
  prediction.actual_value = null;
  prediction.actual_points = null;
  prediction.accuracy = null;
  prediction.dnp = true;
  prediction.dnp_reason = 'Player did not play (injury/rest/DNP)';

  savePredictions(data);
  return prediction;
}

/**
 * Get prediction accuracy statistics
 */
export function getAccuracyStats() {
  const data = loadPredictions();
  const evaluated = data.predictions.filter(p => p.evaluated);
  
  if (evaluated.length === 0) {
    return {
      total_predictions: data.predictions.length,
      evaluated: 0,
      pending: data.predictions.length,
      message: 'No evaluated predictions yet'
    };
  }
  
  const avgError = evaluated.reduce((sum, p) => sum + (p.absolute_error || 0), 0) / evaluated.length;
  const avgAccuracy = evaluated.reduce((sum, p) => sum + (p.accuracy || 0), 0) / evaluated.length;
  const withinMargin = evaluated.filter(p => p.within_margin).length;
  const within2xMargin = evaluated.filter(p => p.within_2x_margin).length;
  
  return {
    total_predictions: data.predictions.length,
    evaluated: evaluated.length,
    pending: data.predictions.length - evaluated.length,
    average_error: Math.round(avgError * 10) / 10,
    average_accuracy: Math.round(avgAccuracy * 10) / 10,
    within_margin_rate: Math.round((withinMargin / evaluated.length) * 100),
    within_2x_margin_rate: Math.round((within2xMargin / evaluated.length) * 100),
    predictions: evaluated.slice(-50) // Last 50 for analysis
  };
}

/**
 * Get predictions that need evaluation (games that have likely been played)
 * Auto-expires predictions older than 30 days as unevaluable
 */
export function getPendingEvaluations() {
  const data = loadPredictions();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let expired = 0;
  const pending = [];

  for (const p of data.predictions) {
    if (p.evaluated || !p.next_game || !p.next_game.date) continue;

    const gameDate = new Date(p.next_game.date);

    // Auto-expire predictions older than 30 days
    if (gameDate < thirtyDaysAgo) {
      p.evaluated = true;
      p.evaluated_at = now.toISOString();
      p.actual_value = null;
      p.actual_points = null;
      p.accuracy = null;
      p.expired = true;
      p.expired_reason = 'Game date older than 30 days, NBA API no longer has this data';
      expired++;
      continue;
    }

    if (gameDate < oneDayAgo) {
      pending.push(p);
    }
  }

  if (expired > 0) {
    savePredictions(data);
  }

  return pending;
}

/**
 * Find prediction by player and game date
 */
export function findPredictionByGame(playerName, gameDate) {
  const data = loadPredictions();
  return data.predictions.find(p => 
    p.player_name.toLowerCase() === playerName.toLowerCase() &&
    p.next_game.date === gameDate &&
    !p.evaluated
  );
}

/**
 * Export evaluated predictions as CSV for XGBoost retraining
 * @param {number} minAccuracy - Minimum accuracy threshold (default: 70)
 */
export function exportForRetraining(minAccuracy = 70) {
  const data = loadPredictions();
  const evaluated = data.predictions.filter(p =>
    p.evaluated &&
    p.accuracy >= minAccuracy
  );

  if (evaluated.length === 0) {
    return { message: 'No high-quality predictions available for retraining' };
  }

  return {
    count: evaluated.length,
    format: 'xgboost_training',
    data: evaluated,
    message: `${evaluated.length} evaluated predictions available. Run 'node backend/scripts/retrainFromTracking.js' to retrain XGBoost models.`
  };
}

/**
 * Get per-player prediction bias for a specific prop type.
 * Computes weighted mean signed error (actual - predicted) from evaluated predictions.
 * Recent predictions are weighted more heavily (exponential decay).
 * Returns null if fewer than 3 evaluated predictions exist.
 *
 * @param {string} playerName - Player name
 * @param {string} propType - Prop type (e.g., 'points', 'assists')
 * @returns {number|null} Mean signed bias (positive = model under-predicts, negative = over-predicts)
 */
/**
 * Get global bias for a prop type — the systematic average error across all
 * predictions of this type. Useful when per-player data is sparse.
 *
 * Returns the signed average residual (actual - predicted). A positive value
 * means the model systematically under-predicts and the prediction should be
 * adjusted up.
 */
const _globalBiasCache = new Map();
export function getGlobalBias(propType = 'points') {
  const cacheKey = propType;
  const cached = _globalBiasCache.get(cacheKey);
  // Cache for 1 hour to avoid recomputing on every prediction
  if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) {
    return cached.value;
  }

  const data = loadPredictions();
  const recent = data.predictions
    .filter(p => p.evaluated && !p.expired && (p.prop_type || 'points') === propType)
    .sort((a, b) => new Date(b.evaluated_at || b.created_at) - new Date(a.evaluated_at || a.created_at))
    .slice(0, 500); // Most recent 500 evaluated predictions

  if (recent.length < 30) {
    _globalBiasCache.set(cacheKey, { value: null, timestamp: Date.now() });
    return null;
  }

  let totalError = 0;
  let count = 0;
  for (const p of recent) {
    const actual = p.actual_value ?? p.actual_points;
    const predicted = p.predicted_value ?? p.predicted_points;
    if (actual == null || predicted == null) continue;
    totalError += actual - predicted;
    count++;
  }

  const bias = count > 0 ? totalError / count : null;
  _globalBiasCache.set(cacheKey, { value: bias, timestamp: Date.now() });
  return bias;
}

const _playerBiasCache = new Map();
export function getPlayerBias(playerName, propType = 'points') {
  const cacheKey = `${playerName.toLowerCase()}|${propType}`;
  const cached = _playerBiasCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) return cached.value;
  const value = computePlayerBias(playerName, propType);
  _playerBiasCache.set(cacheKey, { value, timestamp: Date.now() });
  return value;
}

function computePlayerBias(playerName, propType) {
  const data = loadPredictions();
  const playerPreds = data.predictions.filter(p =>
    p.evaluated &&
    p.player_name.toLowerCase() === playerName.toLowerCase() &&
    (p.prop_type || 'points') === propType
  );

  if (playerPreds.length < 3) return null;

  // Sort by evaluation date (most recent last)
  playerPreds.sort((a, b) => new Date(a.evaluated_at || a.created_at) - new Date(b.evaluated_at || b.created_at));

  // Use last 20 predictions max
  const recent = playerPreds.slice(-20);

  // Exponential decay weights: most recent prediction gets weight 1.0
  let weightedSum = 0;
  let totalWeight = 0;
  const decayRate = 0.15; // ~85% retention per step

  for (let i = 0; i < recent.length; i++) {
    const pred = recent[i];
    const actual = pred.actual_value ?? pred.actual_points;
    const predicted = pred.predicted_value ?? pred.predicted_points;
    if (actual == null || predicted == null) continue;

    const signedError = actual - predicted;
    const weight = Math.exp(-decayRate * (recent.length - 1 - i));
    weightedSum += signedError * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;

  return weightedSum / totalWeight;
}

/**
 * Reset all predictions — used when the model changes significantly
 * to start tracking accuracy from a clean slate.
 * @returns {number} Number of predictions that were cleared
 */
export function resetPredictions() {
  const existing = loadPredictions();
  const count = existing.predictions?.length || 0;
  savePredictions({ predictions: [] });
  console.log(`[PredictionTracking] Reset: cleared ${count} predictions`);
  return count;
}


