import { predictPropFromGames as unifiedPredictProp } from './unifiedPredictionService.js';

/**
 * Predict any prop type from games array
 * This delegates to the unified prediction service
 * @param {array} games - Array of game data
 * @param {string} playerName - Player name
 * @param {string} propType - Type of prop to predict ('points', 'assists', 'rebounds', etc.)
 * @param {object} nextGameInfo - Optional info about next game (for tracking)
 * @param {object} injuryData - Optional injury data
 * @param {number} bettingLine - Optional betting line
 */
export async function predictPropFromGames(games, playerName, propType = 'points', nextGameInfo = null, injuryData = null, bettingLine = null) {
  // Delegate to unified prediction service
  return await unifiedPredictProp(games, playerName, propType, nextGameInfo, injuryData, bettingLine);
}

/**
 * Predict all available props for a player
 * @param {array} games - Array of game data
 * @param {string} playerName - Player name
 * @param {array} propTypes - Array of prop types to predict (e.g., ['points', 'assists', 'rebounds'])
 * @param {object} nextGameInfo - Optional info about next game
 * @param {object} injuryData - Optional injury data
 * @param {object} bettingLines - Optional object with betting lines for each prop type
 */
export async function predictAllProps(games, playerName, propTypes, nextGameInfo = null, injuryData = null, bettingLines = {}) {
  const predictions = {};
  
  // Predict each prop type
  for (const propType of propTypes) {
    try {
      const bettingLine = bettingLines[propType] || null;
      const prediction = await unifiedPredictProp(games, playerName, propType, nextGameInfo, injuryData, bettingLine);
      predictions[propType] = prediction;
      console.log(`✅ Predicted ${propType}: ${prediction[`predicted_${propType}`] || prediction.predicted_points}`);
    } catch (error) {
      console.error(`❌ Failed to predict ${propType} for ${playerName}:`, error.message);
      // Continue with other props even if one fails
    }
  }
  
  return predictions;
}
