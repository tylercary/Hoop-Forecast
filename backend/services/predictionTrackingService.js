import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent storage — use mounted volume in production, local data/ in dev
const PREDICTIONS_DIR = process.env.DATA_DIR || join(__dirname, '../data');
export const DATA_DIR = PREDICTIONS_DIR;
/** SQLite database holding the live prediction store. */
export const DB_FILE = join(PREDICTIONS_DIR, 'predictions.sqlite');
/** The JSON store this service used before SQLite; imported once, then renamed. */
const LEGACY_FILE = join(PREDICTIONS_DIR, 'predictions.json');

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
 * Every prediction the model makes is a row in DATA_DIR/predictions.sqlite:
 * the full record (feature vector included) as JSON in `data`, beside the
 * handful of columns that are indexed or worth querying on their own. Writes
 * are single-row transactions, so a crash or a full disk cannot take the
 * history with it (WAL journal, synchronous=NORMAL); backupService copies the
 * database off the volume nightly.
 *
 * Readers get the record objects from an in-memory cache that is loaded from
 * the database on first use and kept in step with every write (updated in
 * place, inserts appended, deletes removed), so getAllPredictions() stays a
 * cheap array return for the callers that filter it on every request. Nothing
 * on the hot path parses or rewrites a JSON file any more.
 *
 * The JSON store this replaced (predictions.json) is imported on the first
 * start that finds it beside an empty database, then renamed to
 * predictions.json.migrated. Archive files written by archiveLegacyPredictions
 * stay JSON and are read on demand.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS predictions (
  id               TEXT PRIMARY KEY,
  player_name      TEXT COLLATE NOCASE,
  prop_type        TEXT,
  game_date        TEXT,
  created_at       TEXT,
  updated_at       TEXT,
  evaluated        INTEGER NOT NULL DEFAULT 0,
  model_variant    TEXT,
  recommendation   TEXT,
  betting_line     REAL,
  predicted_value  REAL,
  over_probability REAL,
  actual_value     REAL,
  data             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_player_prop_game ON predictions (player_name, prop_type, game_date);
CREATE INDEX IF NOT EXISTS idx_predictions_evaluated ON predictions (evaluated);
CREATE INDEX IF NOT EXISTS idx_predictions_game_date ON predictions (game_date);
`;

let _db = null;
let _stmts = null;

function openDatabase() {
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  _stmts = {
    upsert: db.prepare(`
      INSERT INTO predictions (id, player_name, prop_type, game_date, created_at, updated_at, evaluated,
        model_variant, recommendation, betting_line, predicted_value, over_probability, actual_value, data)
      VALUES (@id, @player_name, @prop_type, @game_date, @created_at, @updated_at, @evaluated,
        @model_variant, @recommendation, @betting_line, @predicted_value, @over_probability, @actual_value, @data)
      ON CONFLICT(id) DO UPDATE SET
        player_name = excluded.player_name, prop_type = excluded.prop_type, game_date = excluded.game_date,
        created_at = excluded.created_at, updated_at = excluded.updated_at, evaluated = excluded.evaluated,
        model_variant = excluded.model_variant, recommendation = excluded.recommendation,
        betting_line = excluded.betting_line, predicted_value = excluded.predicted_value,
        over_probability = excluded.over_probability, actual_value = excluded.actual_value, data = excluded.data`),
    remove: db.prepare('DELETE FROM predictions WHERE id = ?'),
    removeAll: db.prepare('DELETE FROM predictions'),
    count: db.prepare('SELECT count(*) AS n FROM predictions'),
    allData: db.prepare('SELECT data FROM predictions ORDER BY rowid'),
    idsForGame: db.prepare('SELECT id FROM predictions WHERE player_name = ? AND prop_type = ? AND game_date = ?')
  };
  migrateLegacyJson(db);
  return db;
}

function db() {
  if (!_db) _db = openDatabase();
  return _db;
}

/** The open better-sqlite3 connection (backupService runs VACUUM INTO on it). */
export function getDatabase() {
  return db();
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Column values for a record; the whole record goes in `data`. */
function rowFor(record) {
  return {
    id: record.id,
    player_name: record.player_name ?? null,
    prop_type: record.prop_type ?? null,
    game_date: normalizeGameDate(record.next_game?.date),
    created_at: record.created_at ?? null,
    updated_at: record.updated_at ?? null,
    evaluated: record.evaluated ? 1 : 0,
    model_variant: record.model_variant ?? null,
    recommendation: record.recommendation ?? null,
    betting_line: num(record.betting_line),
    predicted_value: num(record.predicted_value ?? record.predicted_points),
    over_probability: num(record.over_probability),
    actual_value: num(record.actual_value ?? record.actual_points),
    data: JSON.stringify(record)
  };
}

/**
 * One-time import of the JSON store. Runs only when the table is empty, so a
 * second start (or a stray predictions.json dropped next to a live database)
 * never doubles or overwrites rows.
 */
function migrateLegacyJson(database) {
  if (!fs.existsSync(LEGACY_FILE)) return;
  const existing = database.prepare('SELECT count(*) AS n FROM predictions').get().n;
  if (existing > 0) {
    console.warn(`[PredictionTracking] ${LEGACY_FILE} found but the database already holds ${existing} rows; leaving it alone`);
    return;
  }
  let records;
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    records = Array.isArray(parsed) ? parsed : (parsed?.predictions || []);
  } catch (error) {
    console.error(`[PredictionTracking] Could not parse ${LEGACY_FILE}; not migrated:`, error.message);
    return;
  }
  const insert = database.prepare(`
    INSERT OR REPLACE INTO predictions (id, player_name, prop_type, game_date, created_at, updated_at, evaluated,
      model_variant, recommendation, betting_line, predicted_value, over_probability, actual_value, data)
    VALUES (@id, @player_name, @prop_type, @game_date, @created_at, @updated_at, @evaluated,
      @model_variant, @recommendation, @betting_line, @predicted_value, @over_probability, @actual_value, @data)`);
  const started = Date.now();
  const imported = database.transaction((rows) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r !== 'object' || !r.id) continue;
      insert.run(rowFor(r));
      n++;
    }
    return n;
  })(records);
  const stored = database.prepare('SELECT count(*) AS n FROM predictions').get().n;
  const target = `${LEGACY_FILE}.migrated`;
  fs.renameSync(LEGACY_FILE, fs.existsSync(target) ? `${target}.${Date.now()}` : target);
  console.log(`[PredictionTracking] Migrated ${imported} of ${records.length} JSON records into SQLite (${stored} rows) in ${Date.now() - started}ms; renamed ${LEGACY_FILE} -> ${target}`);
}

// ---------------------------------------------------------------------------
// In-memory cache of record objects, kept in step with the database
// ---------------------------------------------------------------------------

let _cache = null; // { list: object[], byId: Map<string, object> }

function ensureCache() {
  if (_cache) return _cache;
  const started = Date.now();
  const list = [];
  const byId = new Map();
  for (const row of _stmts.allData.iterate()) {
    const record = JSON.parse(row.data);
    list.push(record);
    byId.set(record.id, record);
  }
  _cache = { list, byId };
  console.log(`[PredictionTracking] Loaded ${list.length} predictions from SQLite in ${Date.now() - started}ms`);
  return _cache;
}

function loadPredictions() {
  db();
  return ensureCache();
}

/** Drop the cache so the next reader rebuilds it from the database. */
function invalidateCache() {
  _cache = null;
}

/** Write one record's row; the caller runs this inside a transaction when it writes several. */
function persist(record) {
  _stmts.upsert.run(rowFor(record));
}

/** Run `fn` inside a transaction; if a write fails, the cache is rebuilt from disk so it cannot drift. */
function write(fn) {
  try {
    return db().transaction(fn)();
  } catch (error) {
    invalidateCache();
    throw error;
  }
}

function cacheInsert(record) {
  if (!_cache) return;
  _cache.list.push(record);
  _cache.byId.set(record.id, record);
}

function cacheRemove(ids) {
  if (!_cache) return;
  const drop = new Set(ids);
  if (drop.size === 0) return;
  _cache.list = _cache.list.filter(p => !drop.has(p.id));
  for (const id of drop) _cache.byId.delete(id);
}

/**
 * Insert records as they are (ids kept, nothing recomputed), replacing rows
 * with the same id. Used by the migration and by scripts that need to seed a
 * store with legacy-shaped records. Returns the number written.
 */
export function importPredictions(records) {
  const rows = (records || []).filter(r => r && typeof r === 'object' && r.id);
  write(() => { for (const r of rows) persist(r); });
  if (_cache) {
    for (const r of rows) {
      const current = _cache.byId.get(r.id);
      if (current) {
        for (const k of Object.keys(current)) delete current[k];
        Object.assign(current, r);
      } else {
        cacheInsert(r);
      }
    }
  }
  return rows.length;
}

/** Checkpoint the WAL into the main database file (used on shutdown and after bulk writes). */
export function flushPredictionsSync() {
  if (!_db) return;
  try {
    _db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    console.error('Error checkpointing predictions:', error);
  }
}

function closeDatabase() {
  flushPredictionsSync();
  try { _db?.close(); } catch { /* already closed */ }
  _db = null;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeDatabase();
    process.exit(0);
  });
}
process.on('beforeExit', flushPredictionsSync);

/** Row count and file size, for /api/health. */
export function getStoreStatus() {
  const rows = db().prepare('SELECT count(*) AS n FROM predictions').get().n;
  let bytes = 0;
  for (const f of [DB_FILE, `${DB_FILE}-wal`]) {
    try { bytes += fs.statSync(f).size; } catch { /* no wal yet */ }
  }
  return { engine: 'sqlite', rows, db_size_mb: Math.round(bytes / 1024 / 1024 * 10) / 10, file: DB_FILE };
}

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
  for (const p of data.list) {
    (p.model_variant === keepVariant ? keep : archive).push(p);
  }
  if (archive.length === 0) return { archived: 0, kept: keep.length, file: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(PREDICTIONS_DIR, `predictions_archive_${stamp}.json`);
  // The archive file is written and complete before any row leaves the database
  fs.writeFileSync(file, JSON.stringify({
    archived_at: new Date().toISOString(),
    reason: `records not from the '${keepVariant}' model`,
    predictions: archive
  }), 'utf8');
  write(() => { for (const p of archive) _stmts.remove.run(p.id); });
  cacheRemove(archive.map(p => p.id));
  _archiveCache = null;
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

/** Every stored prediction (cached array; callers must not mutate it). */
export function getAllPredictions() {
  return loadPredictions().list;
}

/**
 * Raw records for export/analysis, paginated. Feature vectors are large and
 * only included on request.
 */
export function getRawPredictions({ offset = 0, limit = 1000, includeFeatures = false, evaluatedOnly = false, source = 'live' } = {}) {
  const all = source === 'archive' ? getArchivedPredictions() : loadPredictions().list;
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
  const matches = gameDate == null ? [] : _stmts.idsForGame.all(playerName, propType, gameDate)
    .map(r => data.byId.get(r.id))
    .filter(Boolean);
  if (matches.some(p => p.evaluated)) {
    return matches.find(p => p.evaluated).id;
  }
  // Legacy duplicates (two date spellings for one game): keep the newest
  matches.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const existing = matches[0] || null;
  const duplicates = matches.slice(1);

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
    model_version: prediction.model_version ?? null,
    caution: prediction.caution ?? null,
    factors: prediction.factors ?? null,
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
    const changed = existing.model_version !== predictionRecord.model_version ||
      existing.predicted_value !== predictionRecord.predicted_value ||
      existing.betting_line !== predictionRecord.betting_line ||
      existing.over_probability !== predictionRecord.over_probability ||
      existing.recommendation !== predictionRecord.recommendation;
    if (!changed) {
      if (duplicates.length) {
        write(() => { for (const dup of duplicates) _stmts.remove.run(dup.id); });
        cacheRemove(duplicates.map(p => p.id));
      }
      return existing.id;
    }
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
        // Pick-time market and best price, so closing line value is measured
        // from the first time the pick was shown (closingLineService)
        market: existing.market || null,
        best_bet: existing.best_bet || null,
        at: created_at
      }
    });
    write(() => {
      for (const dup of duplicates) _stmts.remove.run(dup.id);
      persist(existing);
    });
    cacheRemove(duplicates.map(p => p.id));
    return existing.id;
  }

  write(() => {
    for (const dup of duplicates) _stmts.remove.run(dup.id);
    persist(predictionRecord);
  });
  cacheRemove(duplicates.map(p => p.id));
  cacheInsert(predictionRecord);
  return predictionRecord.id;
}

/**
 * Record the closing market for a prediction (closingLineService). The first
 * snapshot wins: a record's `closing` is never overwritten, so the job can run
 * as often as it likes. Returns true when the snapshot was stored.
 */
export function setClosingSnapshot(predictionId, closing) {
  if (!closing) return false;
  const data = loadPredictions();
  const prediction = data.byId.get(predictionId);
  if (!prediction || prediction.closing || prediction.evaluated) return false;
  prediction.closing = closing;
  write(() => persist(prediction));
  return true;
}

/**
 * Update prediction with actual outcome
 * @param {string} predictionId - Prediction ID
 * @param {number} actualPoints - Actual points scored
 */
export function updatePredictionOutcome(predictionId, actualPoints) {
  const data = loadPredictions();
  const prediction = data.byId.get(predictionId);

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

  write(() => persist(prediction));

  return prediction;
}

/**
 * Mark a prediction as DNP (player did not play)
 * Removes it from pending evaluations without counting as a hit/miss
 */
export function markPredictionDNP(predictionId) {
  const data = loadPredictions();
  const prediction = data.byId.get(predictionId);
  if (!prediction) return null;

  prediction.evaluated = true;
  prediction.evaluated_at = new Date().toISOString();
  prediction.actual_value = null;
  prediction.actual_points = null;
  prediction.accuracy = null;
  prediction.dnp = true;
  prediction.dnp_reason = 'Player did not play (injury/rest/DNP)';

  write(() => persist(prediction));
  return prediction;
}

/**
 * Get prediction accuracy statistics
 */
export function getAccuracyStats() {
  const predictions = loadPredictions().list;
  const evaluated = predictions.filter(p => p.evaluated);

  if (evaluated.length === 0) {
    return {
      total_predictions: predictions.length,
      evaluated: 0,
      pending: predictions.length,
      message: 'No evaluated predictions yet'
    };
  }

  const avgError = evaluated.reduce((sum, p) => sum + (p.absolute_error || 0), 0) / evaluated.length;
  const avgAccuracy = evaluated.reduce((sum, p) => sum + (p.accuracy || 0), 0) / evaluated.length;
  const withinMargin = evaluated.filter(p => p.within_margin).length;
  const within2xMargin = evaluated.filter(p => p.within_2x_margin).length;

  return {
    total_predictions: predictions.length,
    evaluated: evaluated.length,
    pending: predictions.length - evaluated.length,
    average_error: Math.round(avgError * 10) / 10,
    average_accuracy: Math.round(avgAccuracy * 10) / 10,
    within_margin_rate: Math.round((withinMargin / evaluated.length) * 100),
    within_2x_margin_rate: Math.round((within2xMargin / evaluated.length) * 100),
    predictions: evaluated.slice(-50) // Last 50 for analysis
  };
}

/** Hours after tip-off before a game is considered final and gradable. */
export const GRADE_AFTER_TIP_HOURS = 4;

/**
 * Get predictions that need evaluation (games that have likely been played)
 * Auto-expires predictions older than 30 days as unevaluable
 *
 * A record with a tip-off time is pending once GRADE_AFTER_TIP_HOURS have
 * passed since it (the game is over by then; ESPN posts the box score within
 * minutes). Without one, the game date must be more than a day old. The date
 * is a UTC calendar day, so a 10pm ET game stored as the next day would
 * otherwise wait almost two days, and a 7pm ET game could be looked up while
 * still in progress.
 */
export function getPendingEvaluations({ now: nowMs = Date.now() } = {}) {
  const predictions = loadPredictions().list;
  const now = new Date(nowMs);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const expired = [];
  const pending = [];

  for (const p of predictions) {
    if (p.evaluated || !p.next_game || !p.next_game.date) continue;

    const gameDate = new Date(`${normalizeGameDate(p.next_game.date)}T00:00:00Z`);
    if (Number.isNaN(gameDate.getTime())) continue;

    // Auto-expire predictions older than 30 days
    if (gameDate < thirtyDaysAgo) {
      p.evaluated = true;
      p.evaluated_at = now.toISOString();
      p.actual_value = null;
      p.actual_points = null;
      p.accuracy = null;
      p.expired = true;
      p.expired_reason = 'Game date older than 30 days, NBA API no longer has this data';
      expired.push(p);
      continue;
    }

    const tip = p.next_game.commence_time ? new Date(p.next_game.commence_time) : null;
    if (tip && !Number.isNaN(tip.getTime())) {
      if (now.getTime() - tip.getTime() >= GRADE_AFTER_TIP_HOURS * 60 * 60 * 1000) pending.push(p);
    } else if (gameDate < oneDayAgo) {
      pending.push(p);
    }
  }

  if (expired.length > 0) {
    write(() => { for (const p of expired) persist(p); });
  }

  return pending;
}

/**
 * One record per player + prop + game, dated in ISO.
 *
 * Records written before game dates were normalised can exist twice for one
 * game ("Oct 20, 2026" beside "2026-10-20"); both would be graded and counted.
 * This rewrites every next_game.date to YYYY-MM-DD and collapses duplicates:
 * a graded record with an actual value wins, otherwise the newest (the same
 * rule storePrediction applies). Idempotent; run at startup.
 */
export function dedupeGamePredictions() {
  const data = loadPredictions();
  const normalizedRecords = [];
  const groups = new Map();
  for (const p of data.list) {
    const iso = normalizeGameDate(p.next_game?.date);
    if (iso && iso !== p.next_game.date) {
      p.next_game.date = iso;
      normalizedRecords.push(p);
    }
    if (!iso || !p.player_name) continue;
    const key = `${p.player_name.toLowerCase()}|${p.prop_type || 'points'}|${iso}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  const removed = [];
  const stamp = (p) => new Date(p.updated_at || p.created_at || 0).getTime();
  const graded = (p) => p.evaluated && !p.dnp && !p.expired && p.actual_value != null;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (graded(b) - graded(a)) || (stamp(b) - stamp(a)));
    for (const dup of group.slice(1)) removed.push(dup);
  }
  const normalized = normalizedRecords.length;
  if (normalized || removed.length) {
    const drop = new Set(removed.map(p => p.id));
    write(() => {
      for (const p of normalizedRecords) if (!drop.has(p.id)) persist(p);
      for (const p of removed) _stmts.remove.run(p.id);
    });
    cacheRemove(drop);
    console.log(`[PredictionTracking] Normalised ${normalized} game dates, removed ${removed.length} duplicate records`);
  }
  return { normalized, removed: removed.map(p => ({ id: p.id, player: p.player_name, prop: p.prop_type, date: p.next_game?.date })) };
}

/**
 * Find prediction by player and game date
 */
export function findPredictionByGame(playerName, gameDate) {
  const predictions = loadPredictions().list;
  return predictions.find(p =>
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
  const predictions = loadPredictions().list;
  const evaluated = predictions.filter(p =>
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

  const predictions = loadPredictions().list;
  const recent = predictions
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
  const predictions = loadPredictions().list;
  const playerPreds = predictions.filter(p =>
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
  const count = loadPredictions().list.length;
  write(() => _stmts.removeAll.run());
  _cache = { list: [], byId: new Map() };
  console.log(`[PredictionTracking] Reset: cleared ${count} predictions`);
  return count;
}
