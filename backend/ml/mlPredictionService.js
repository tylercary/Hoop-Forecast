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

const XGBOOST_SCRIPT = path.join(__dirname, 'predict_xgboost.py');
const MODELS_DIR = path.join(__dirname, 'models');

/**
 * Build features object for ML model prediction
 * @param {Array} gameLogs - Array of player game logs
 * @param {string} propType - Prop type (PTS, REB, AST, etc.)
 * @returns {Object} - Features object
 */
/**
 * context (all optional, describe the UPCOMING game):
 *   isHome       true/false for the next game
 *   nextGameDate ISO string or Date of the next game (for rest-day features)
 */
function buildMLFeatures(gameLogs, propType, context = {}) {
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
  // Training data carried NBA.com's per-game fg_pct (0-1); ESPN logs give makes/attempts
  const fgPct = recentGames.map(g => {
    const pct = parseFloat(g.fg_pct ?? g.field_goal_pct);
    if (!isNaN(pct) && pct > 0) return pct > 1 ? pct / 100 : pct;
    const made = parseFloat(g.fgm ?? g.field_goals_made) || 0;
    const att = parseFloat(g.fga ?? g.field_goals_attempted) || 0;
    return att > 0 ? made / att : 0;
  });
  // Training used NBA.com's "wl"; ESPN logs call it "result"
  const winLoss = recentGames.map(g => {
    const raw = String(g.wl ?? g.result ?? g.win_loss ?? '').trim().toUpperCase();
    return raw.startsWith('W') ? 'W' : raw.startsWith('L') ? 'L' : null;
  });
  const gameDate = (g) => new Date(g.date || g.game_date);
  const lastGameDate = gameDate(recentGames[recentGames.length - 1]);
  const nextGameDate = context.nextGameDate ? new Date(context.nextGameDate) : null;
  const hasNextDate = nextGameDate && !isNaN(nextGameDate.getTime()) && nextGameDate > lastGameDate;
  // Rest features describe the upcoming game when we know its date; otherwise
  // fall back to the gap before the last game (the old behaviour)
  const restDays = hasNextDate
    ? Math.round((nextGameDate - lastGameDate) / 86400000)
    : recentGames.length >= 2
      ? Math.round((lastGameDate - gameDate(recentGames[recentGames.length - 2])) / 86400000)
      : 1;
  const referenceDate = hasNextDate ? nextGameDate : lastGameDate;
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

    // Rest before the upcoming game (same definitions as training)
    days_rest: Math.max(0, Math.min(restDays, 7)),
    is_back_to_back: restDays === 1 ? 1 : 0,
    games_in_last_week: (() => {
      const weekAgo = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return recentGames.filter(g => {
        const d = gameDate(g);
        return d >= weekAgo && d < referenceDate || (!hasNextDate && d.getTime() === referenceDate.getTime());
      }).length;
    })(),

    // Win/loss streaks
    win_streak: (() => {
      let streak = 0;
      for (let i = winLoss.length - 1; i >= Math.max(0, winLoss.length - 10); i--) {
        if (winLoss[i] === 'W') streak++;
        else break;
      }
      return streak;
    })(),

    loss_streak: (() => {
      let streak = 0;
      for (let i = winLoss.length - 1; i >= Math.max(0, winLoss.length - 10); i--) {
        if (winLoss[i] === 'L') streak++;
        else break;
      }
      return streak;
    })(),

    recent_win_pct: (() => {
      const last10 = winLoss.slice(-10).filter(Boolean);
      if (last10.length === 0) return 0.5;
      return last10.filter(r => r === 'W').length / last10.length;
    })(),

    // === EFFICIENCY & SHOOTING TRENDS ===
    fg_pct_avg_10: avg(fgPct, 10),
    fg_pct_trend: avg(fgPct, 3) - avg(fgPct, 10),
    ft_rate_avg_10: avg(fta, 10),

    // === MINUTES DEVIATION ===
    min_std_10: std(minutes, 10),
    min_trend: avg(minutes, 3) - avg(minutes, 10),
    // Share of the last 10 games under 25 minutes (edge_features.minutes_under_share)
    min_under25_share_10: (() => {
      const last = minutes.slice(-10);
      return last.length ? last.filter(m => m < 25).length / last.length : 0;
    })(),

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

    // Upcoming game is home? (unknown -> 0, matching the old default)
    is_home: context.isHome === true || context.isHome === 1 ? 1 : 0
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
 * Call XGBoost prediction script
 * @param {Object} features - Features object
 * @param {string} propType - Prop type (PTS, REB, AST, etc.)
 * @returns {Promise<number>} - Predicted value
 */
function callXGBoostPredictor(features, propTypes, edgeRows = null) {
  const list = Array.isArray(propTypes) ? propTypes : [propTypes];
  return new Promise((resolve, reject) => {
    const args = [
      XGBOOST_SCRIPT,
      JSON.stringify(features),
      list.map(p => p.toUpperCase()).join(','),
      MODELS_DIR
    ];
    if (edgeRows && edgeRows.length > 0) args.push(JSON.stringify(edgeRows));

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
          return reject(new Error(result.error || Object.values(result.errors || {}).join('; ') || 'Prediction failed'));
        }
        resolve(result);
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
 * Predict prop value using XGBoost model
 * @param {Array} gameLogs - Player game logs
 * @param {string} propType - Prop type (PTS, REB, AST, 3PM, PRA, PR, PA, RA)
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} - { prediction, features }
 */
async function predictProp(gameLogs, propType, options = {}) {
  const { predictions, features } = await predictProps(gameLogs, [propType], options);
  if (predictions[propType.toUpperCase()] == null) {
    throw new Error(`No prediction returned for ${propType}`);
  }
  return { prediction: predictions[propType.toUpperCase()], features };
}

// Pooled edge model (actual - line). Keep in step with train_edge_model.py.
const EDGE_PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
const EDGE_STAT_PARTS = {
  points: ['pts'], rebounds: ['reb'], assists: ['ast'], threes: ['threes'],
  pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast']
};
const EDGE_METADATA_FILE = path.join(MODELS_DIR, 'edge_xgb_metadata.json');
let _edgeMetadata;
function getEdgeMetadata() {
  if (_edgeMetadata === undefined) {
    try {
      _edgeMetadata = JSON.parse(fs.readFileSync(EDGE_METADATA_FILE, 'utf8'));
    } catch {
      _edgeMetadata = null;
    }
  }
  return _edgeMetadata;
}

// Context features: null means unknown, scored as a missing value. Each block
// has a twin in backend/ml/edge_features.py; keep them identical.
const num = (v) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const EDGE_OPP_PART_KEY = { pts: 'opp_pts_allowed_rel', reb: 'opp_reb_allowed_rel', ast: 'opp_ast_allowed_rel', threes: 'opp_fg3m_allowed_rel' };
const EDGE_OPPONENT_KEYS = ['opp_pts_allowed_rel', 'opp_reb_allowed_rel', 'opp_ast_allowed_rel', 'opp_fg3m_allowed_rel',
  'opp_pace_rel', 'opp_def_rating_rel', 'opp_games_n'];

/** market: marketFeatureService.summarizeMarket output (or null). Twin: edge_features.market_features */
function marketFeatures(market, line) {
  const out = { mkt_over_prob: null, mkt_line_spread: null, mkt_n_books: null, mkt_pinnacle_minus_line: null, mkt_line_minus_mean: null };
  if (!market) return out;
  out.mkt_over_prob = num(market.over_prob_novig);
  out.mkt_line_spread = num(market.line_spread);
  out.mkt_n_books = num(market.n_books);
  const pin = num(market.pinnacle_line);
  out.mkt_pinnacle_minus_line = pin == null ? null : Math.round((pin - line) * 100) / 100;
  const meanLine = num(market.line_mean);
  out.mkt_line_minus_mean = meanLine == null ? null : Math.round((line - meanLine) * 1000) / 1000;
  return out;
}

/** opponent: teamContextService.opponentContext output (or null). Twin: edge_features.opponent_features */
function opponentFeatures(opponent, prop) {
  const out = {};
  for (const k of EDGE_OPPONENT_KEYS) out[k] = opponent ? num(opponent[k]) : null;
  const parts = EDGE_STAT_PARTS[prop].map(part => out[EDGE_OPP_PART_KEY[part]]);
  out.opp_stat_allowed_rel = parts.some(v => v == null) ? null : r3(parts.reduce((a, b) => a + b, 0));
  return out;
}

/** risk: { game_spread_abs, teammates_out_key } (or null). Twin: edge_features.risk_features */
function riskFeatures(risk) {
  return { game_spread_abs: num(risk?.game_spread_abs), teammates_out_key: num(risk?.teammates_out_key) };
}

/**
 * One row for the edge model: the base features plus the line and how it sits
 * against the player's averages for that prop, plus the context the line does
 * not state (market price, opponent, minutes risk).
 * @param {Object} features  output of buildMLFeatures
 * @param {string} prop      lower-case prop key (points, rebounds, ...)
 * @param {number} line      sportsbook line
 * @param {Object} [context] { market, opponent, risk } (see the helpers above)
 */
function buildEdgeRow(features, prop, line, context = {}) {
  const parts = EDGE_STAT_PARTS[prop];
  if (!parts || !(line > 0)) return null;
  const row = { ...features };
  if (row.min_under25_share_10 == null) row.min_under25_share_10 = null;
  for (const win of ['3', '5', '10', 'season']) {
    row[`stat_avg_${win}`] = parts.reduce((sum, part) => sum + (Number(features[`${part}_avg_${win}`]) || 0), 0);
  }
  row.line = line;
  row.line_minus_avg10 = line - row.stat_avg_10;
  row.line_minus_avg5 = line - row.stat_avg_5;
  row.line_minus_season = line - row.stat_avg_season;
  row.line_over_avg10 = line / Math.max(row.stat_avg_10, 0.5);
  for (const p of EDGE_PROPS) row[`prop_${p}`] = p === prop ? 1 : 0;
  Object.assign(row, marketFeatures(context.market || null, line));
  Object.assign(row, opponentFeatures(context.opponent || null, prop));
  Object.assign(row, riskFeatures(context.risk || null));
  return row;
}

/**
 * Predict several prop types with one feature build and one Python process.
 * When `lines` ({ prop: line }) is given and the edge model is trained, the
 * same process also scores the pooled edge model for every lined prop.
 * edgeContext: { markets: { prop: market summary }, opponent, risk } (see buildEdgeRow)
 * @returns {Promise<{predictions: Object, errors: Object, features: Object, edge: Object}>}
 *   edge: { prop: { residual, probabilityMap } } for props the edge model scored
 */
async function predictProps(gameLogs, propTypes, context = {}, lines = null, edgeContext = {}) {
  const features = buildMLFeatures(gameLogs, propTypes[0], context);
  const edgeMeta = lines ? getEdgeMetadata() : null;
  const edgeProps = [];
  const edgeRows = [];
  if (edgeMeta) {
    for (const [prop, line] of Object.entries(lines)) {
      const row = buildEdgeRow(features, prop, Number(line), {
        market: edgeContext.markets?.[prop] || null,
        opponent: edgeContext.opponent || null,
        risk: edgeContext.risk || null
      });
      if (row) { edgeProps.push(prop); edgeRows.push(row); }
    }
  }
  const result = await callXGBoostPredictor(features, propTypes, edgeRows);
  const predictions = {};
  for (const [prop, value] of Object.entries(result.predictions || {})) {
    predictions[prop] = Math.max(0, value);
  }
  const edge = {};
  if (Array.isArray(result.edge)) {
    result.edge.forEach((residual, i) => {
      if (residual != null && Number.isFinite(residual)) {
        edge[edgeProps[i]] = { residual, probabilityMap: edgeMeta.probability_map };
      }
    });
  }
  const summary = Object.entries(predictions).map(([p, v]) => `${p} ${v.toFixed(1)}`).join(', ');
  const edgeSummary = Object.entries(edge).map(([p, e]) => `${p} ${e.residual >= 0 ? '+' : ''}${e.residual.toFixed(1)}`).join(', ');
  console.log(`✅ [XGBoost] ${summary}${edgeSummary ? ` | edge vs line: ${edgeSummary}` : ''}`);
  return { predictions, errors: result.errors || {}, features, edge };
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
  predictProps,
  buildEdgeRow,
  marketFeatures,
  opponentFeatures,
  riskFeatures,
  predictAllProps,
  buildMLFeatures,
  areModelsAvailable
};
