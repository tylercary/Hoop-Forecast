/**
 * Compare Service - Handles prediction comparison with betting lines
 * Ensures each prop has its own prediction pipeline
 * Uses ONLY correct vegas line for each prop
 */

import { predictPropFromGames } from './unifiedPredictionService.js';

/**
 * Generate prediction for a specific prop type
 * @param {Array} games - Game log array
 * @param {string} playerName - Player name
 * @param {string} propType - Prop type (points, rebounds, assists, threes, pra, pr, pa, ra)
 * @param {object} nextGameInfo - Next game information
 * @param {object} injuryData - Injury data
 * @param {number|null} vegasLine - Vegas line for this specific prop (REQUIRED)
 * @returns {Promise<object>} Prediction result with recommendation
 */
export async function generatePropPrediction(games, playerName, propType, nextGameInfo, injuryData, vegasLine) {
  try {
    // Validate inputs
    if (!games || games.length < 3) {
      return {
        predicted_value: null,
        confidence: null,
        recommendation: null,
        error_margin: null,
        error: 'Insufficient game data'
      };
    }

    if (!vegasLine || vegasLine <= 0) {
      return {
        predicted_value: null,
        confidence: null,
        recommendation: null,
        error_margin: null,
        error: 'Vegas line not available for this prop'
      };
    }

    // Generate prediction using unified service
    const prediction = await predictPropFromGames(
      games,
      playerName,
      propType,
      nextGameInfo,
      injuryData,
      vegasLine
    );

    if (!prediction) {
      return {
        predicted_value: null,
        confidence: null,
        recommendation: null,
        error_margin: null,
        error: 'Prediction generation failed'
      };
    }

    // Extract predicted value based on prop type
    let predictedValue = null;
    if (propType === 'points') {
      predictedValue = prediction.predicted_points || prediction.predicted_value || null;
    } else if (propType === 'rebounds') {
      predictedValue = prediction.predicted_rebounds || prediction.predicted_value || null;
    } else if (propType === 'assists') {
      predictedValue = prediction.predicted_assists || prediction.predicted_value || null;
    } else if (propType === 'threes') {
      predictedValue = prediction.predicted_threes || prediction.predicted_value || null;
    } else if (propType === 'pra') {
      predictedValue = prediction.predicted_pra || prediction.predicted_value || null;
    } else if (propType === 'pr') {
      predictedValue = prediction.predicted_pr || prediction.predicted_value || null;
    } else if (propType === 'pa') {
      predictedValue = prediction.predicted_pa || prediction.predicted_value || null;
    } else if (propType === 'ra') {
      predictedValue = prediction.predicted_ra || prediction.predicted_value || null;
    } else {
      predictedValue = prediction.predicted_value || null;
    }

    // Determine recommendation
    let recommendation = null;
    if (predictedValue != null && vegasLine != null) {
      const difference = predictedValue - vegasLine;
      if (Math.abs(difference) < 0.5) {
        recommendation = 'PUSH';
      } else if (difference > 0) {
        recommendation = 'OVER';
      } else {
        recommendation = 'UNDER';
      }
    }

    return {
      predicted_value: predictedValue,
      confidence: prediction.confidence || null,
      recommendation: recommendation,
      error_margin: prediction.error_margin || prediction.errorMargin || null,
      analysis: prediction.analysis || null,
      stats: prediction.stats || null
    };
  } catch (error) {
    console.error(`❌ Error generating prediction for ${propType}:`, error.message);
    return {
      predicted_value: null,
      confidence: null,
      recommendation: null,
      error_margin: null,
      error: error.message
    };
  }
}

/**
 * Generate predictions for all available props
 * @param {Array} games - Game log array
 * @param {string} playerName - Player name
 * @param {object} allProps - All props from odds service
 * @param {object} nextGameInfo - Next game information
 * @param {object} injuryData - Injury data
 * @returns {Promise<object>} Object with predictions for each prop
 */
export async function generateAllPropPredictions(games, playerName, allProps, nextGameInfo, injuryData) {
  const predictions = {};
  
  // Generate prediction for each prop that has a line
  const propTypes = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
  
  for (const propType of propTypes) {
    const prop = allProps[propType];
    
    // Skip if prop is unavailable or has no line
    if (!prop || prop.status === 'unavailable' || !prop.line) {
      predictions[propType] = {
        predicted_value: null,
        confidence: null,
        recommendation: null,
        error_margin: null,
        status: 'unavailable'
      };
      continue;
    }
    
    // Generate prediction with the correct vegas line for this prop
    const prediction = await generatePropPrediction(
      games,
      playerName,
      propType,
      nextGameInfo,
      injuryData,
      prop.line
    );
    
    predictions[propType] = prediction;
  }
  
  return predictions;
}

