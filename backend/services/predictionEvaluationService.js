import { getPendingEvaluations, updatePredictionOutcome, findPredictionByGame, markPredictionDNP } from './predictionTrackingService.js';
import { getPlayerStatsFromNBA } from './nbaApiService.js';

/**
 * Automatically evaluate pending predictions by fetching actual game results
 * This matches predictions with their actual outcomes from NBA.com
 */
export async function evaluatePendingPredictions() {
  const pending = getPendingEvaluations();

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
      const propLabel = propType === 'points' ? 'pts' : propType;

      // Fetch player's recent games (use cache to avoid duplicate API calls)
      const playerKey = prediction.player_name.toLowerCase();
      let stats = playerStatsCache.get(playerKey) ?? null;

      if (!stats) {
        // Add delay between API requests (not for cached lookups)
        if (playerStatsCache.size > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Retry logic with exponential backoff for timeout errors
        let retries = 0;
        const maxRetries = 2;

        while (retries <= maxRetries && !stats) {
          try {
            stats = await getPlayerStatsFromNBA(prediction.player_name);
          } catch (error) {
            if (error.message.includes('timeout') && retries < maxRetries) {
              retries++;
              const backoffDelay = 3000 * retries;
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
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
        const daysSinceGame = (Date.now() - new Date(prediction.next_game.date).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceGame >= 3) {
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
      // Games are returned most recent first
      const targetDate = prediction.next_game.date;
      const matchingGame = stats.games.find(game => {
        // Compare dates (handle different formats)
        const gameDate = new Date(game.date);
        const targetDateObj = new Date(targetDate);
        
        // Compare year, month, day (ignore time)
        return gameDate.getFullYear() === targetDateObj.getFullYear() &&
               gameDate.getMonth() === targetDateObj.getMonth() &&
               gameDate.getDate() === targetDateObj.getDate();
      });
      
      if (!matchingGame) {
        // If game date is 3+ days ago, player likely didn't play (DNP/injury/rest)
        const daysSinceGame = (Date.now() - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceGame >= 3) {
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
      const statMap = {
        'points': g => g.pts ?? g.points ?? 0,
        'rebounds': g => g.reb ?? g.rebounds ?? 0,
        'assists': g => g.ast ?? g.assists ?? 0,
        'threes': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
        'steals': g => g.stl ?? g.steals ?? 0,
        'blocks': g => g.blk ?? g.blocks ?? 0,
        'pra': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
        'pr': g => (g.pts ?? 0) + (g.reb ?? 0),
        'pa': g => (g.pts ?? 0) + (g.ast ?? 0),
        'ra': g => (g.reb ?? 0) + (g.ast ?? 0),
      };
      const extractor = statMap[propType] || statMap['points'];
      const actualValue = extractor(matchingGame);

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
        await new Promise(resolve => setTimeout(resolve, 1000));
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


