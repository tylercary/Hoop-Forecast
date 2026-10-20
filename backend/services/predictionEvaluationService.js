import { getPendingEvaluations, updatePredictionOutcome, findPredictionByGame, markPredictionDNP, normalizeGameDate } from './predictionTrackingService.js';
import { getPlayerStats } from './nbaApiService.js';

/** Days a game can go unmatched in the ESPN log before the player counts as DNP. */
export const DNP_AFTER_DAYS = 3;

/** YYYY-MM-DD in UTC for an ISO timestamp, shifted by `hours`. */
function utcDateOf(iso, hours = 0) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + hours * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * The ESPN game-log entry for a prediction's game.
 *
 * ESPN dates its game log by the UTC timestamp of tip-off, and the store keeps
 * the same convention, so a 10pm ET game on Oct 20 is "2026-10-21" on both
 * sides and matches on the date alone. The fallbacks cover a record whose date
 * was written in the local (US) convention: the UTC date of commence_time, and
 * the date 12 hours earlier, are also accepted when the opponent agrees.
 * Dates are compared as normalised strings, so "Oct 20, 2026" and "2026-10-20"
 * are the same day whatever the server's timezone.
 */
export function findGameForPrediction(games, prediction) {
  if (!Array.isArray(games) || !prediction?.next_game) return null;
  const stored = normalizeGameDate(prediction.next_game.date);
  if (!stored) return null;
  const byDate = (date) => games.find(g => normalizeGameDate(g.date) === date) || null;
  const exact = byDate(stored);
  if (exact) return exact;

  const opponent = (prediction.next_game.opponent || prediction.opponent || '').toUpperCase();
  const tip = prediction.next_game.commence_time;
  const candidates = [utcDateOf(tip), utcDateOf(tip, -12)].filter(d => d && d !== stored);
  for (const date of [...new Set(candidates)]) {
    const game = byDate(date);
    if (game && (!opponent || !game.opponent || game.opponent.toUpperCase() === opponent)) return game;
  }
  return null;
}

const STAT_EXTRACTORS = {
  'points': g => g.pts ?? g.points ?? 0,
  'rebounds': g => g.reb ?? g.rebounds ?? 0,
  'assists': g => g.ast ?? g.assists ?? 0,
  'threes': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
  'steals': g => g.stl ?? g.steals ?? 0,
  'blocks': g => g.blk ?? g.blocks ?? 0,
  'pra': g => (g.pts ?? g.points ?? 0) + (g.reb ?? g.rebounds ?? 0) + (g.ast ?? g.assists ?? 0),
  'pr': g => (g.pts ?? g.points ?? 0) + (g.reb ?? g.rebounds ?? 0),
  'pa': g => (g.pts ?? g.points ?? 0) + (g.ast ?? g.assists ?? 0),
  'ra': g => (g.reb ?? g.rebounds ?? 0) + (g.ast ?? g.assists ?? 0),
};

/** The prop stat a game-log entry produced for a prop type. */
export function actualForProp(game, propType) {
  const extractor = STAT_EXTRACTORS[propType] || STAT_EXTRACTORS.points;
  return extractor(game);
}

/**
 * Automatically evaluate pending predictions by fetching actual game results
 * This matches predictions with their actual outcomes from NBA.com
 *
 * @param {object} [options] test hooks: fetchStats(playerName) in place of the
 *   ESPN lookup, now() for the clock, delays=false to skip the rate limiting
 */
export async function evaluatePendingPredictions(options = {}) {
  const fetchStats = options.fetchStats || getPlayerStats;
  const now = options.now || (() => Date.now());
  const delays = options.delays !== false;
  const sleep = (ms) => (delays ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());
  const pending = getPendingEvaluations({ now: now() });

  if (pending.length === 0) {
    return {
      evaluated: 0,
      failed: 0,
      skipped: 0,
      results: []
    };
  }

  const results = {
    evaluated: 0,
    failed: 0,
    skipped: 0,
    expired: 0,
    results: []
  };

  // Cache player stats to avoid duplicate API calls for the same player
  const playerStatsCache = new Map();

  // Process predictions with rate limiting (avoid API overload)
  for (let i = 0; i < pending.length; i++) {
    const prediction = pending[i];

    // Skip already-expired predictions (auto-expired by getPendingEvaluations)
    if (prediction.expired) {
      results.expired++;
      continue;
    }

    try {
      const propType = prediction.prop_type || 'points';
      const predictedVal = prediction.predicted_value ?? prediction.predicted_points;
      const targetDate = normalizeGameDate(prediction.next_game.date);
      const daysSinceGame = (now() - new Date(`${targetDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24);

      // Fetch player's recent games (use cache to avoid duplicate API calls)
      const playerKey = prediction.player_name.toLowerCase();
      let stats = playerStatsCache.get(playerKey) ?? null;

      if (!stats) {
        // Add delay between API requests (not for cached lookups)
        if (playerStatsCache.size > 0) {
          await sleep(2000);
        }

        // Retry logic with exponential backoff for timeout errors
        let retries = 0;
        const maxRetries = 2;

        while (retries <= maxRetries && !stats) {
          try {
            stats = await fetchStats(prediction.player_name);
          } catch (error) {
            if (error.message.includes('timeout') && retries < maxRetries) {
              retries++;
              await sleep(3000 * retries);
              continue;
            }
            throw error;
          }
        }

        // Cache regardless of result (avoid re-fetching failures)
        playerStatsCache.set(playerKey, stats || { games: [] });
      }

      if (!stats || !stats.games || stats.games.length === 0) {
        // If game date is 3+ days ago and no stats exist, mark as DNP
        if (daysSinceGame >= DNP_AFTER_DAYS) {
          markPredictionDNP(prediction.id);
          results.evaluated++;
          results.results.push({ predictionId: prediction.id, player: prediction.player_name, status: 'dnp', reason: 'No game data available' });
        } else {
          results.skipped++;
          results.results.push({ predictionId: prediction.id, player: prediction.player_name, status: 'skipped', reason: 'No game data available' });
        }
        continue;
      }

      // Find the game that matches the prediction date
      const matchingGame = findGameForPrediction(stats.games, prediction);

      if (!matchingGame) {
        // If game date is 3+ days ago, player likely didn't play (DNP/injury/rest)
        if (daysSinceGame >= DNP_AFTER_DAYS) {
          markPredictionDNP(prediction.id);
          results.evaluated++;
          results.results.push({ predictionId: prediction.id, player: prediction.player_name, status: 'dnp', reason: `Player did not play on ${targetDate}` });
        } else {
          results.skipped++;
          results.results.push({ predictionId: prediction.id, player: prediction.player_name, status: 'skipped', reason: `Game not found for date ${targetDate}` });
        }
        continue;
      }

      // Extract actual value based on prop type
      const actualValue = actualForProp(matchingGame, propType);

      // Update the prediction with actual outcome
      const updated = updatePredictionOutcome(prediction.id, actualValue);

      if (updated) {
        const error = Math.abs(predictedVal - actualValue);

        results.evaluated++;
        results.results.push({
          predictionId: prediction.id,
          player: prediction.player_name,
          prop_type: propType,
          status: 'evaluated',
          predicted: predictedVal,
          actual: actualValue,
          error: error,
          accuracy: updated.accuracy,
          withinMargin: updated.within_margin
        });
      } else {
        throw new Error('Failed to update prediction');
      }

      // Rate limiting: wait 1 second between API calls to avoid overwhelming NBA.com
      if (i < pending.length - 1) {
        await sleep(1000);
      }

    } catch (error) {
      console.error(`   ❌ Error evaluating prediction ${prediction.id}:`, error.message);
      results.failed++;
      results.results.push({
        predictionId: prediction.id,
        player: prediction.player_name,
        status: 'failed',
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Evaluate a specific prediction by ID
 */
export async function evaluatePredictionById(predictionId, actualPoints) {
  try {
    const updated = updatePredictionOutcome(predictionId, actualPoints);

    if (!updated) {
      return {
        success: false,
        error: 'Prediction not found'
      };
    }

    return {
      success: true,
      prediction: updated
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Find and evaluate a specific prediction by player name and game date
 */
export async function evaluatePredictionByGame(playerName, gameDate, actualPoints) {
  try {
    const prediction = findPredictionByGame(playerName, gameDate);

    if (!prediction) {
      return {
        success: false,
        error: 'No matching prediction found'
      };
    }

    const updated = updatePredictionOutcome(prediction.id, actualPoints);

    return {
      success: true,
      prediction: updated
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
