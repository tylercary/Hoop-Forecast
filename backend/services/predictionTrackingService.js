import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent storage for predictions and outcomes
const PREDICTIONS_FILE = join(__dirname, '../data/predictions.json');
const PREDICTIONS_DIR = join(__dirname, '../data');

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
 * Load predictions from file
 */
function loadPredictions() {
  try {
    if (fs.existsSync(PREDICTIONS_FILE)) {
      const data = fs.readFileSync(PREDICTIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading predictions:', error);
  }
  return { predictions: [] };
}

/**
 * Save predictions to file
 */
function savePredictions(data) {
  try {
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving predictions:', error);
  }
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
export function storePrediction(playerName, prediction, gameHistory, nextGameInfo = {}, propType = 'points', featureVector = null) {
  const data = loadPredictions();
  const gameDate = nextGameInfo.date || null;

  // Deduplication: skip if same player + prop_type + game date already exists
  const existing = data.predictions.find(p =>
    p.player_name?.toLowerCase() === playerName.toLowerCase() &&
    p.prop_type === propType &&
    p.next_game?.date === gameDate &&
    gameDate != null
  );
  if (existing) {
    return existing.id; // Already tracked, return existing ID
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
    method: prediction.method || 'xgboost_model',
    stats: prediction.stats || {},
    game_history_hash: hashParts,
    next_game: {
      date: gameDate,
      opponent: nextGameInfo.opponent || null,
      is_home: nextGameInfo.isHome || null,
      team: nextGameInfo.team || null
    },
    feature_vector: featureVector || null, // Full ML features for retraining
    prop_type_formatted: prediction.method === 'xgboost_model' ? (PROP_TYPE_FORMAT_MAP[propType] || propType.toUpperCase()) : null,
    created_at: new Date().toISOString(),
    actual_value: null, // Will be filled when outcome is known
    actual_points: null, // backward compat
    accuracy: null,
    evaluated: false
  };

  data.predictions.push(predictionRecord);
  savePredictions(data);

  const propLabel = propType === 'points' ? 'pts' : propType;
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
      total_predictions: 0,
      evaluated: 0,
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
export function getPlayerBias(playerName, propType = 'points') {
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


