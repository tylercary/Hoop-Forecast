/**
 * ML Prediction Service
 * Node.js wrapper for XGBoost and PyTorch models
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_SCRIPT = path.join(__dirname, 'predict.py');
const XGBOOST_SCRIPT = path.join(__dirname, 'predict_xgboost.py');
const MODELS_DIR = path.join(__dirname, 'models');

/**
 * Build features object for ML model prediction
 * @param {Array} gameLogs - Array of player game logs
 * @param {string} propType - Prop type (PTS, REB, AST, etc.)
 * @returns {Object} - Features object
 */
function buildMLFeatures(gameLogs, propType) {
  if (!gameLogs || gameLogs.length < 10) {
    throw new Error('Need at least 10 game logs to calculate features');
  }

  // Sort by date (oldest first)
  const sortedGames = [...gameLogs].sort((a, b) => {
    const dateA = new Date(a.date || a.game_date);
    const dateB = new Date(b.date || b.game_date);
    return dateA - dateB;
  });

  // Use most recent games for features
  const recentGames = sortedGames.slice(-50); // Last 50 games

  // Extract stat arrays (support both API field names: g.pts/g.points, g.reb/g.rebounds, etc.)
  const pts = recentGames.map(g => parseFloat(g.pts ?? g.points) || 0);
  const reb = recentGames.map(g => parseFloat(g.reb ?? g.rebounds) || 0);
  const ast = recentGames.map(g => parseFloat(g.ast ?? g.assists) || 0);
  const threes = recentGames.map(g => parseFloat(g.tpm ?? g.fg3m ?? g.threes_made ?? g.threes) || 0);
  const minutes = recentGames.map(g => parseFloat(g.minutes) || 0);
  const fga = recentGames.map(g => parseFloat(g.fga ?? g.field_goals_attempted) || 0);
  const fg3a = recentGames.map(g => parseFloat(g.fg3a ?? g.three_pointers_attempted ?? g.threes_attempted) || 0);
  const fgPct = recentGames.map(g => parseFloat(g.fg_pct ?? g.field_goal_pct) || 0);
  const fta = recentGames.map(g => parseFloat(g.fta ?? g.free_throws_attempted) || 0);
  const plusMinus = recentGames.map(g => parseFloat(g.plus_minus ?? g.plusMinus) || 0);

  // Helper functions
  const avg = (arr, n) => {
    const slice = arr.slice(-n);
    return slice.reduce((sum, val) => sum + val, 0) / slice.length;
  };

  const std = (arr, n) => {
    const slice = arr.slice(-n);
    const mean = avg(slice, slice.length);
    const squaredDiffs = slice.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / slice.length;
    return Math.sqrt(variance);
  };

  const volatility = (arr, n) => {
    const slice = arr.slice(-n);
    const mean = avg(slice, slice.length);
    if (mean === 0) return 0;
    const stdDev = std(slice, slice.length);
    return (stdDev / mean) * 100;
  };

  // Calculate all features
  const features = {
    // Points features
    pts_avg_3: avg(pts, 3),
    pts_avg_5: avg(pts, 5),
    pts_avg_10: avg(pts, 10),
    pts_avg_season: avg(pts, pts.length),
    pts_std_10: std(pts, 10),
    pts_volatility: volatility(pts, 10),

    // Rebounds features
    reb_avg_3: avg(reb, 3),
    reb_avg_5: avg(reb, 5),
    reb_avg_10: avg(reb, 10),
    reb_avg_season: avg(reb, reb.length),
    reb_std_10: std(reb, 10),
    reb_volatility: volatility(reb, 10),

    // Assists features
    ast_avg_3: avg(ast, 3),
    ast_avg_5: avg(ast, 5),
    ast_avg_10: avg(ast, 10),
    ast_avg_season: avg(ast, ast.length),
    ast_std_10: std(ast, 10),
    ast_volatility: volatility(ast, 10),

    // Three-pointers features
    threes_avg_3: avg(threes, 3),
    threes_avg_5: avg(threes, 5),
    threes_avg_10: avg(threes, 10),
    threes_avg_season: avg(threes, threes.length),
    threes_std_10: std(threes, 10),
    threes_volatility: volatility(threes, 10),

    // Minutes & usage
    min_avg_3: avg(minutes, 3),
    min_avg_5: avg(minutes, 5),
    min_avg_10: avg(minutes, 10),
    usage: calculateUsage(avg(pts, 10), avg(minutes, 10)),

    // Shooting
    fga_avg_10: avg(fga, 10),
    fg3a_avg_10: avg(fg3a, 10),

    // Combined props
    pra_avg_3: avg(pts, 3) + avg(reb, 3) + avg(ast, 3),
    pra_avg_5: avg(pts, 5) + avg(reb, 5) + avg(ast, 5),
    pra_avg_10: avg(pts, 10) + avg(reb, 10) + avg(ast, 10),
    pr_avg_3: avg(pts, 3) + avg(reb, 3),
    pr_avg_5: avg(pts, 5) + avg(reb, 5),
    pr_avg_10: avg(pts, 10) + avg(reb, 10),
    pa_avg_3: avg(pts, 3) + avg(ast, 3),
    pa_avg_5: avg(pts, 5) + avg(ast, 5),
    pa_avg_10: avg(pts, 10) + avg(ast, 10),
    ra_avg_3: avg(reb, 3) + avg(ast, 3),
    ra_avg_5: avg(reb, 5) + avg(ast, 5),
    ra_avg_10: avg(reb, 10) + avg(ast, 10),

    // Hot streak indicators (recent vs season average)
    pts_hot_streak: avg(pts, 3) - avg(pts, pts.length),
    reb_hot_streak: avg(reb, 3) - avg(reb, reb.length),
    ast_hot_streak: avg(ast, 3) - avg(ast, ast.length),
    threes_hot_streak: avg(threes, 3) - avg(threes, threes.length),

    // Performance momentum (last game vs 3 games ago)
    pts_momentum: pts.length >= 3 ? (pts[pts.length - 1] - pts[pts.length - 3]) / 3 : 0,
    reb_momentum: reb.length >= 3 ? (reb[reb.length - 1] - reb[reb.length - 3]) / 3 : 0,
    ast_momentum: ast.length >= 3 ? (ast[ast.length - 1] - ast[ast.length - 3]) / 3 : 0,

    // Consecutive games over season average
    pts_over_streak: (() => {
      let streak = 0;
      const seasonAvg = avg(pts, pts.length);
      for (let i = pts.length - 1; i >= Math.max(0, pts.length - 5); i--) {
        if (pts[i] > seasonAvg) streak++;
        else break;
      }
      return streak;
    })(),

    // Days rest (calculate from game dates if available)
    days_rest: (() => {
      if (recentGames.length < 2) return 1;
      const lastGame = new Date(recentGames[recentGames.length - 1].date || recentGames[recentGames.length - 1].game_date);
      const prevGame = new Date(recentGames[recentGames.length - 2].date || recentGames[recentGames.length - 2].game_date);
      const daysDiff = Math.round((lastGame - prevGame) / (1000 * 60 * 60 * 24));
      return Math.max(0, Math.min(daysDiff, 7));
    })(),

    is_back_to_back: (() => {
      if (recentGames.length < 2) return 0;
      const lastGame = new Date(recentGames[recentGames.length - 1].date || recentGames[recentGames.length - 1].game_date);
      const prevGame = new Date(recentGames[recentGames.length - 2].date || recentGames[recentGames.length - 2].game_date);
      const daysDiff = Math.round((lastGame - prevGame) / (1000 * 60 * 60 * 24));
      return daysDiff === 1 ? 1 : 0;
    })(),

    games_in_last_week: (() => {
      if (recentGames.length === 0) return 0;
      const lastGame = new Date(recentGames[recentGames.length - 1].date || recentGames[recentGames.length - 1].game_date);
      const weekAgo = new Date(lastGame.getTime() - 7 * 24 * 60 * 60 * 1000);
      return recentGames.filter(g => {
        const gDate = new Date(g.date || g.game_date);
        return gDate >= weekAgo && gDate <= lastGame;
      }).length;
    })(),

    // Win/loss streaks
    win_streak: (() => {
      let streak = 0;
      for (let i = recentGames.length - 1; i >= Math.max(0, recentGames.length - 10); i--) {
        if (recentGames[i].wl === 'W') streak++;
        else break;
      }
      return streak;
    })(),

    loss_streak: (() => {
      let streak = 0;
      for (let i = recentGames.length - 1; i >= Math.max(0, recentGames.length - 10); i--) {
        if (recentGames[i].wl === 'L') streak++;
        else break;
      }
      return streak;
    })(),

    recent_win_pct: (() => {
      const last10 = recentGames.slice(-10);
      if (last10.length === 0) return 0.5;
      const wins = last10.filter(g => g.wl === 'W').length;
      return wins / last10.length;
    })(),

    // === EFFICIENCY & SHOOTING TRENDS ===
    fg_pct_avg_10: avg(fgPct, 10),
    fg_pct_trend: avg(fgPct, 3) - avg(fgPct, 10),
    ft_rate_avg_10: avg(fta, 10),

    // === MINUTES DEVIATION ===
    min_std_10: std(minutes, 10),
    min_trend: avg(minutes, 3) - avg(minutes, 10),

    // === PLUS/MINUS CONTEXT ===
    plus_minus_avg_10: avg(plusMinus, 10),

    // === CROSS-STAT INTERACTIONS ===
    pts_per_min_10: avg(minutes, 10) > 0 ? avg(pts, 10) / avg(minutes, 10) : 0,
    fga_trend: avg(fga.slice(-3), 3) - avg(fga.slice(-10), 10),
    reb_per_min_10: avg(minutes, 10) > 0 ? avg(reb, 10) / avg(minutes, 10) : 0,

    // === CONSISTENCY FEATURES ===
    pts_hit_rate: (() => {
      const last10 = pts.slice(-10);
      const seasonAvg = avg(pts, pts.length);
      if (last10.length === 0 || seasonAvg === 0) return 0.5;
      const threshold = seasonAvg * 0.2;
      return last10.filter(v => Math.abs(v - seasonAvg) <= threshold).length / last10.length;
    })(),
    reb_hit_rate: (() => {
      const last10 = reb.slice(-10);
      const seasonAvg = avg(reb, reb.length);
      if (last10.length === 0 || seasonAvg === 0) return 0.5;
      const threshold = Math.max(seasonAvg * 0.25, 1.5);
      return last10.filter(v => Math.abs(v - seasonAvg) <= threshold).length / last10.length;
    })(),

    // Context
    is_home: 0 // Default to away, can be overridden
  };

  // Replace NaN with 0
  Object.keys(features).forEach(key => {
    if (isNaN(features[key]) || !isFinite(features[key])) {
      features[key] = 0;
    }
  });

  return features;
}

/**
 * Calculate usage rate
 */
function calculateUsage(avgPoints, avgMinutes) {
  if (!avgMinutes || avgMinutes === 0) return 0;
  const usage = (avgPoints / avgMinutes) * 2.5;
  return Math.min(Math.max(usage, 0), 100);
}

/**
 * Call Python prediction script
 * @param {Object} features - Features object
 * @param {string} propType - Prop type (PTS, REB, AST, etc.)
 * @returns {Promise<number>} - Predicted value
 */
function callPythonPredictor(features, propType) {
  return new Promise((resolve, reject) => {
    const args = [
      PYTHON_SCRIPT,
      '--features', JSON.stringify(features),
      '--prop-type', propType.toUpperCase(),
      '--models-dir', MODELS_DIR
    ];

    const python = spawn('python3', args);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python script failed: ${stderr}`));
      }

      try {
        const result = JSON.parse(stdout);
        if (!result.success) {
          return reject(new Error(result.error));
        }
        resolve(result.prediction);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${stdout}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python: ${error.message}`));
    });
  });
}

/**
 * Call XGBoost prediction script
 * @param {Object} features - Features object
 * @param {string} propType - Prop type (PTS, REB, AST, etc.)
 * @returns {Promise<number>} - Predicted value
 */
function callXGBoostPredictor(features, propType) {
  return new Promise((resolve, reject) => {
    const args = [
      XGBOOST_SCRIPT,
      JSON.stringify(features),
      propType.toUpperCase(),
      MODELS_DIR
    ];

    const python = spawn('python3', args);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`XGBoost script failed: ${stderr}`));
      }

      try {
        const result = JSON.parse(stdout);
        if (!result.success) {
          return reject(new Error(result.error));
        }
        resolve(result.prediction);
      } catch (error) {
        reject(new Error(`Failed to parse XGBoost output: ${stdout}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python: ${error.message}`));
    });
  });
}

/**
 * Predict prop value using custom ML model
 * Tries XGBoost first, falls back to PyTorch
 * @param {Array} gameLogs - Player game logs
 * @param {string} propType - Prop type (PTS, REB, AST, 3PM, PRA, PR, PA, RA)
 * @param {Object} options - Optional parameters
 * @returns {Promise<number>} - Predicted value
 */
async function predictProp(gameLogs, propType, options = {}) {
  try {
    // Build features
    const features = buildMLFeatures(gameLogs, propType);

    // Override is_home if provided
    if (options.isHome !== undefined) {
      features.is_home = options.isHome ? 1 : 0;
    }

    // Try XGBoost first (faster, better for tabular data)
    try {
      const prediction = await callXGBoostPredictor(features, propType);
      const bounded = Math.max(0, prediction);
      console.log(`✅ [XGBoost] ${propType} prediction: ${bounded.toFixed(2)}`);
      return { prediction: bounded, features };
    } catch (xgbError) {
      // Fall back to PyTorch if XGBoost fails
      console.log(`⚠️  [XGBoost] Failed for ${propType}, trying PyTorch: ${xgbError.message}`);
      const prediction = await callPythonPredictor(features, propType);
      const bounded = Math.max(0, prediction);
      console.log(`✅ [PyTorch] ${propType} prediction: ${bounded.toFixed(2)}`);
      return { prediction: bounded, features };
    }
  } catch (error) {
    console.error(`ML prediction error for ${propType}:`, error.message);
    throw error;
  }
}

/**
 * Predict all prop types for a player
 * @param {Array} gameLogs - Player game logs
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} - Predictions for all prop types
 */
async function predictAllProps(gameLogs, options = {}) {
  const propTypes = ['PTS', 'REB', 'AST', '3PM', 'PRA', 'PR', 'PA', 'RA'];
  const predictions = {};

  for (const propType of propTypes) {
    try {
      const result = await predictProp(gameLogs, propType, options);
      predictions[propType] = result.prediction;
    } catch (error) {
      console.error(`Failed to predict ${propType}:`, error.message);
      predictions[propType] = null;
    }
  }

  return predictions;
}

/**
 * Check if ML models are available
 * @returns {boolean} - True if models exist
 */
function areModelsAvailable() {
  const propTypes = ['pts', 'reb', 'ast', '3pm', 'pra', 'pr', 'pa', 'ra'];

  for (const prop of propTypes) {
    const modelPath = path.join(MODELS_DIR, `${prop}_model.pth`);
    if (!fs.existsSync(modelPath)) {
      return false;
    }
  }

  return true;
}

export {
  predictProp,
  predictAllProps,
  buildMLFeatures,
  areModelsAvailable
};
