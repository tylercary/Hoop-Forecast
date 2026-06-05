/**
 * Performance Tracking Service
 * Reads prediction data from predictionTrackingService's predictions.json
 * and computes hit rates and performance metrics for the frontend dashboard.
 *
 * "Hit" definition: prediction was within its stated error margin (within_margin === true).
 * Fallback: if within_margin is unavailable, accuracy >= 60.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same predictions file used by predictionTrackingService
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');
const PERFORMANCE_CACHE_TTL = 300; // 5 minutes

// In-memory cache for performance metrics
let performanceCache = null;
let performanceCacheTime = 0;

/**
 * Load all predictions from storage (predictionTrackingService format)
 */
function loadPredictions() {
  try {
    if (!fs.existsSync(PREDICTIONS_FILE)) return [];
    const data = fs.readFileSync(PREDICTIONS_FILE, 'utf8');
    return JSON.parse(data).predictions || [];
  } catch (error) {
    console.error('Error loading predictions:', error);
    return [];
  }
}

/**
 * Determine if a prediction was a "hit"
 * A hit = the model correctly predicted OVER or UNDER the betting line.
 * If no betting line is stored, falls back to checking if the prediction
 * was on the correct side of the season average.
 */
function isHit(pred) {
  const predicted = pred.predicted_value ?? pred.predicted_points;
  const actual = pred.actual_value ?? pred.actual_points;
  if (predicted == null || actual == null) return false;

  const line = pred.betting_line;

  if (line != null) {
    // Primary: did the model pick the right side of the line?
    if (predicted === line) return actual === line; // push edge case
    const predictedOver = predicted > line;
    const actualOver = actual > line;
    return predictedOver === actualOver;
  }

  // Fallback for old predictions without a stored line:
  // use season average as a proxy line
  const seasonAvg = pred.stats?.overall_avg;
  if (seasonAvg != null) {
    const predictedOver = predicted > seasonAvg;
    const actualOver = actual > seasonAvg;
    return predictedOver === actualOver;
  }

  // Last resort: within 20% of predicted value
  const absError = Math.abs(predicted - actual);
  return absError <= predicted * 0.2;
}

/**
 * Calculate overall performance metrics
 * Reads predictionTrackingService data format and transforms for frontend
 * @returns {Object} Performance statistics matching frontend expectations
 */
function calculatePerformance() {
  // Check cache first
  const now = Date.now();
  if (performanceCache && (now - performanceCacheTime) < PERFORMANCE_CACHE_TTL * 1000) {
    return performanceCache;
  }

  const predictions = loadPredictions();

  // Filter to evaluated predictions with actual values (exclude expired and DNP)
  const evaluated = predictions.filter(p =>
    p.evaluated && !p.expired && !p.dnp && p.actual_value != null
  );
  const pending = predictions.filter(p => !p.evaluated);

  if (evaluated.length === 0) {
    const emptyStats = {
      overall: {
        total: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        pending: pending.length
      },
      byPropType: {},
      recentPredictions: [],
      lastUpdated: new Date().toISOString()
    };

    performanceCache = emptyStats;
    performanceCacheTime = now;
    return emptyStats;
  }

  // Compute hit/miss for each evaluated prediction
  const resolved = evaluated.map(p => ({
    ...p,
    _isHit: isHit(p)
  }));

  // Overall stats
  const hits = resolved.filter(p => p._isHit).length;
  const misses = resolved.length - hits;
  const hitRate = (hits / resolved.length) * 100;

  // Stats by prop type
  const byPropType = {};
  resolved.forEach(p => {
    const propType = p.prop_type || 'points';
    if (!byPropType[propType]) {
      byPropType[propType] = { total: 0, hits: 0, misses: 0, hitRate: 0 };
    }
    byPropType[propType].total++;
    if (p._isHit) {
      byPropType[propType].hits++;
    } else {
      byPropType[propType].misses++;
    }
  });

  // Calculate hit rates per prop type
  Object.values(byPropType).forEach(stats => {
    stats.hitRate = stats.total > 0 ? (stats.hits / stats.total) * 100 : 0;
  });

  // Recent predictions: only resolved ones with actual results (no pending/expired/DNP)
  const recentPredictions = evaluated
    .sort((a, b) => new Date(b.evaluated_at || b.created_at || 0) - new Date(a.evaluated_at || a.created_at || 0))
    .slice(0, 20)
    .map(p => {
      const predictedVal = p.predicted_value ?? p.predicted_points;
      const actualVal = p.actual_value ?? p.actual_points;
      const hit = isHit(p);

      return {
        id: p.id,
        playerName: p.player_name,
        propType: p.prop_type || 'points',
        prediction: predictedVal,
        actual: actualVal,
        result: hit ? 'hit' : 'miss',
        isResolved: true,
        timestamp: p.created_at,
        gameDate: p.next_game?.date || null,
        opponent: p.next_game?.opponent || p.opponent || null,
        accuracy: p.accuracy,
        absoluteError: p.absolute_error,
        bettingLine: p.betting_line || null,
        recommendation: p.recommendation || null,
        overProbability: p.over_probability || null,
        edgeStrength: p.edge_strength || null,
        confidence: p.confidence || null,
        matchupImpact: p.matchup_impact || null
      };
    });

  // Average error for resolved predictions
  const avgError = evaluated.reduce((sum, p) => sum + (p.absolute_error || 0), 0) / evaluated.length;

  // High-confidence picks breakdown (edge_strength >= 8 or confidence = 'High'/'Medium')
  const highConfPicks = resolved.filter(p =>
    p.edge_strength >= 8 || p.confidence === 'High' || p.confidence === 'Medium'
  );
  const highConfHits = highConfPicks.filter(p => p._isHit).length;
  const highConfHitRate = highConfPicks.length > 0
    ? Math.round((highConfHits / highConfPicks.length) * 1000) / 10
    : 0;

  const performance = {
    overall: {
      total: resolved.length,
      hits,
      misses,
      hitRate: Math.round(hitRate * 10) / 10,
      pending: pending.length,
      avgError: Math.round(avgError * 10) / 10
    },
    highConfidence: {
      total: highConfPicks.length,
      hits: highConfHits,
      misses: highConfPicks.length - highConfHits,
      hitRate: highConfHitRate
    },
    byPropType,
    recentPredictions,
    lastUpdated: new Date().toISOString()
  };

  // Cache the results
  performanceCache = performance;
  performanceCacheTime = now;

  return performance;
}

/**
 * Get predictions for a specific player
 * @param {string} playerName - Player name
 * @returns {Array} Predictions for the player (transformed for frontend)
 */
function getPlayerPredictions(playerName) {
  const predictions = loadPredictions();
  return predictions
    .filter(p => (p.player_name || '').toLowerCase() === playerName.toLowerCase())
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(p => ({
      id: p.id,
      playerName: p.player_name,
      propType: p.prop_type || 'points',
      prediction: p.predicted_value ?? p.predicted_points,
      actual: p.actual_value ?? p.actual_points,
      result: p.evaluated && !p.expired && p.actual_value != null
        ? (isHit(p) ? 'hit' : 'miss')
        : null,
      isResolved: p.evaluated && !p.expired && p.actual_value != null,
      timestamp: p.created_at,
      gameDate: p.next_game?.date || null,
      opponent: p.next_game?.opponent || null,
      accuracy: p.accuracy
    }));
}

/**
 * Get predictions for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Array} Predictions for the date
 */
function getPredictionsByDate(date) {
  const predictions = loadPredictions();
  return predictions
    .filter(p => p.next_game?.date === date)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(p => ({
      id: p.id,
      playerName: p.player_name,
      propType: p.prop_type || 'points',
      prediction: p.predicted_value ?? p.predicted_points,
      actual: p.actual_value ?? p.actual_points,
      result: p.evaluated && !p.expired && p.actual_value != null
        ? (isHit(p) ? 'hit' : 'miss')
        : null,
      isResolved: p.evaluated && !p.expired && p.actual_value != null,
      timestamp: p.created_at,
      gameDate: p.next_game?.date || null,
      opponent: p.next_game?.opponent || null,
      accuracy: p.accuracy
    }));
}

/**
 * Cleanup is handled by predictionTrackingService's auto-expiry.
 * This is kept for API compatibility.
 */
function cleanupOldPredictions() {
  return 0;
}

/**
 * Legacy stubs kept for backtestModel.js compatibility.
 * Actual prediction tracking is handled by predictionTrackingService.js.
 */
function trackPrediction(data) {
  console.warn('performanceTrackingService.trackPrediction() is deprecated. Use predictionTrackingService instead.');
  return { id: `legacy_${Date.now()}`, ...data };
}

function updatePredictionResult(id, actualValue) {
  console.warn('performanceTrackingService.updatePredictionResult() is deprecated. Use predictionTrackingService instead.');
  return { id, actual: actualValue };
}

export {
  calculatePerformance,
  getPlayerPredictions,
  getPredictionsByDate,
  cleanupOldPredictions,
  trackPrediction,
  updatePredictionResult
};
