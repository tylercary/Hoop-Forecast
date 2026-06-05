/**
 * Game Prediction Tracking Service
 * Stores, evaluates, and tracks game outcome predictions (spread, total, winner).
 *
 * Evaluation uses ESPN scoreboard data to get final scores.
 * A prediction is evaluated on 3 axes:
 *   - Winner: did we pick the right team?
 *   - Spread: did the favored team cover?
 *   - Total: was the actual total over or under our predicted total?
 */

import fs from 'fs';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || join(__dirname, '../data');
const GAME_PREDICTIONS_FILE = join(DATA_DIR, 'game_predictions.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadGamePredictions() {
  try {
    if (fs.existsSync(GAME_PREDICTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(GAME_PREDICTIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[GamePredTracking] Load error:', e.message);
  }
  return { predictions: [] };
}

function saveGamePredictions(data) {
  try {
    fs.writeFileSync(GAME_PREDICTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[GamePredTracking] Save error:', e.message);
  }
}

/**
 * Store a game prediction for future evaluation
 */
export function storeGamePrediction(prediction, gameId, homeTeam, awayTeam, gameDate) {
  const data = loadGamePredictions();

  // Deduplicate by gameId
  const existing = data.predictions.find(p => p.gameId === gameId && !p.evaluated);
  if (existing) {
    // Update in place with latest prediction
    existing.prediction = prediction;
    existing.updated_at = new Date().toISOString();
    saveGamePredictions(data);
    return existing.id;
  }

  const record = {
    id: `gpred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    gameId,
    homeTeam,
    awayTeam,
    gameDate,
    prediction: {
      homeWinProb: prediction.homeWinProb,
      awayWinProb: prediction.awayWinProb,
      predictedSpread: prediction.predictedSpread,
      predictedTotal: prediction.predictedTotal,
      confidence: prediction.confidence,
      vegasCalibrated: prediction.factors?.vegasCalibrated || false,
      vegasSpread: prediction.vegasComparison?.vegasSpread || null,
      vegasTotal: prediction.vegasComparison?.vegasTotal || null,
    },
    // Outcome fields — filled after evaluation
    actual: null,
    evaluated: false,
    created_at: new Date().toISOString()
  };

  data.predictions.push(record);
  saveGamePredictions(data);
  return record.id;
}

/**
 * Evaluate pending game predictions using ESPN scores
 */
export async function evaluatePendingGamePredictions() {
  const data = loadGamePredictions();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const pending = data.predictions.filter(p => {
    if (p.evaluated) return false;
    const gd = new Date(p.gameDate);
    if (gd > oneDayAgo) return false; // game likely not finished
    if (gd < thirtyDaysAgo) {
      // Auto-expire old ones
      p.evaluated = true;
      p.expired = true;
      p.evaluated_at = now.toISOString();
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    saveGamePredictions(data);
    return { evaluated: 0, failed: 0, results: [] };
  }

  const results = { evaluated: 0, failed: 0, results: [] };

  // Fetch scores from ESPN for each pending prediction's game
  for (const pred of pending) {
    try {
      const { data: espnData } = await axios.get(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary`,
        { params: { event: pred.gameId }, timeout: 10000 }
      );

      const event = espnData.header?.competitions?.[0];
      const status = event?.status?.type;
      if (!status?.completed) {
        continue; // Game not finished yet
      }

      const competitors = event?.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      const homeScore = parseInt(home?.score) || 0;
      const awayScore = parseInt(away?.score) || 0;

      if (homeScore === 0 && awayScore === 0) continue;

      const actualTotal = homeScore + awayScore;
      const actualSpread = homeScore - awayScore; // positive = home won by X
      const homeWon = homeScore > awayScore;

      // Evaluate predictions
      const predSpread = pred.prediction.predictedSpread;
      const predTotal = pred.prediction.predictedTotal;
      const predHomeFavored = predSpread > 0; // positive spread = home favored

      // Winner: did we predict the right winner?
      const predictedHomeWin = pred.prediction.homeWinProb > 50;
      const winnerCorrect = predictedHomeWin === homeWon;

      // Spread: did the favored team cover our predicted spread?
      // If we predicted home -5, and home won by 7, they covered
      const spreadCorrect = predSpread > 0
        ? actualSpread >= predSpread  // home favored: did home cover?
        : actualSpread <= predSpread; // away favored: did away cover?
      const spreadError = Math.abs(actualSpread - predSpread);

      // Total: was actual over or under our predicted total?
      const predictedOver = actualTotal > predTotal;
      const totalError = Math.abs(actualTotal - predTotal);

      // Also check vs Vegas if available
      let vegasSpreadCorrect = null;
      let vegasTotalCorrect = null;
      if (pred.prediction.vegasSpread != null) {
        vegasSpreadCorrect = pred.prediction.vegasSpread > 0
          ? actualSpread >= pred.prediction.vegasSpread
          : actualSpread <= pred.prediction.vegasSpread;
      }
      if (pred.prediction.vegasTotal != null) {
        vegasTotalCorrect = actualTotal > pred.prediction.vegasTotal ? 'over' : 'under';
      }

      pred.actual = {
        homeScore,
        awayScore,
        actualTotal,
        actualSpread,
        homeWon
      };
      pred.results = {
        winnerCorrect,
        spreadCorrect,
        spreadError: Math.round(spreadError * 10) / 10,
        totalDirection: predictedOver ? 'over' : 'under',
        totalError: Math.round(totalError * 10) / 10,
        vegasSpreadCorrect,
        vegasTotalCorrect
      };
      pred.evaluated = true;
      pred.evaluated_at = now.toISOString();

      results.evaluated++;
      results.results.push({
        gameId: pred.gameId,
        matchup: `${pred.awayTeam} @ ${pred.homeTeam}`,
        winnerCorrect,
        spreadCorrect,
        spreadError: Math.round(spreadError * 10) / 10,
        totalError: Math.round(totalError * 10) / 10,
        score: `${awayScore}-${homeScore}`
      });

      // Rate limit ESPN calls
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[GamePredTracking] Error evaluating ${pred.gameId}: ${err.message}`);
      results.failed++;
    }
  }

  saveGamePredictions(data);
  return results;
}

/**
 * Get game prediction performance stats
 */
export function getGamePredictionStats() {
  const data = loadGamePredictions();
  const evaluated = data.predictions.filter(p => p.evaluated && !p.expired && p.results);
  const pending = data.predictions.filter(p => !p.evaluated);

  if (evaluated.length === 0) {
    return {
      total: 0,
      pending: pending.length,
      winnerAccuracy: 0,
      spreadAccuracy: 0,
      avgSpreadError: 0,
      avgTotalError: 0,
      recentPredictions: []
    };
  }

  const winnerHits = evaluated.filter(p => p.results.winnerCorrect).length;
  const spreadHits = evaluated.filter(p => p.results.spreadCorrect).length;
  const avgSpreadError = evaluated.reduce((s, p) => s + (p.results.spreadError || 0), 0) / evaluated.length;
  const avgTotalError = evaluated.reduce((s, p) => s + (p.results.totalError || 0), 0) / evaluated.length;

  // High confidence picks
  const highConf = evaluated.filter(p => p.prediction.confidence === 'high');
  const highConfWinnerHits = highConf.filter(p => p.results.winnerCorrect).length;

  const recentPredictions = evaluated
    .sort((a, b) => new Date(b.evaluated_at || b.created_at) - new Date(a.evaluated_at || a.created_at))
    .slice(0, 20)
    .map(p => ({
      gameId: p.gameId,
      matchup: `${p.awayTeam} @ ${p.homeTeam}`,
      gameDate: p.gameDate,
      predictedSpread: p.prediction.predictedSpread,
      predictedTotal: p.prediction.predictedTotal,
      homeWinProb: p.prediction.homeWinProb,
      confidence: p.prediction.confidence,
      actualScore: p.actual ? `${p.actual.awayScore}-${p.actual.homeScore}` : null,
      actualTotal: p.actual?.actualTotal,
      winnerCorrect: p.results?.winnerCorrect,
      spreadCorrect: p.results?.spreadCorrect,
      spreadError: p.results?.spreadError,
      totalError: p.results?.totalError
    }));

  return {
    total: evaluated.length,
    pending: pending.length,
    winnerAccuracy: Math.round((winnerHits / evaluated.length) * 1000) / 10,
    spreadAccuracy: Math.round((spreadHits / evaluated.length) * 1000) / 10,
    avgSpreadError: Math.round(avgSpreadError * 10) / 10,
    avgTotalError: Math.round(avgTotalError * 10) / 10,
    highConfidence: {
      total: highConf.length,
      winnerAccuracy: highConf.length > 0 ? Math.round((highConfWinnerHits / highConf.length) * 1000) / 10 : 0
    },
    recentPredictions
  };
}
