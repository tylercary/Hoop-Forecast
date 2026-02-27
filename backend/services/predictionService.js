import { predictPropFromGames } from './unifiedPredictionService.js';

/**
 * Predict points from games array
 * This is a wrapper that delegates to the unified prediction service
 */
export async function predictPointsFromGames(games, playerName, nextGameInfo = null, injuryData = null, bettingLine = null) {
  return await predictPropFromGames(games, playerName, 'points', nextGameInfo, injuryData, bettingLine);
}
