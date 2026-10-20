/**
 * Compare Service - Handles prediction comparison with betting lines
 * Ensures each prop has its own prediction pipeline
 * Uses ONLY correct vegas line for each prop
 */

import { predictPropFromGames, predictPropsFromGames } from './unifiedPredictionService.js';
import { summarizeMarket } from './marketFeatureService.js';

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
export async function generatePropPrediction(games, playerName, propType, nextGameInfo, injuryData, vegasLine, propData = null) {
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
      vegasLine,
      propData ? { markets: { [propType]: summarizeMarket(propData) }, books: { [propType]: propData } } : {}
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

    return {
      predicted_value: predictedValue,
      confidence: prediction.confidence || null,
      // null when the backend sees no real edge; the page shows a lean instead
      recommendation: prediction.recommendation ?? null,
      over_probability: prediction.over_probability ?? null,
      error_margin: prediction.error_margin || prediction.errorMargin || null,
      analysis: prediction.analysis || null,
      stats: prediction.stats || null,
      model_value: prediction.model_value ?? null,
      opponent: prediction.opponent || null,
      best_bet: prediction.best_bet ?? null,
      book_edges: prediction.book_edges ?? null
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
 * @param {object} [options] - { gameSpread: oddsService.getGameSpread result }
 * @returns {Promise<object>} Object with predictions for each prop
 */
export async function generateAllPropPredictions(games, playerName, allProps, nextGameInfo, injuryData, options = {}) {
  const propTypes = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
  const predictions = {};
  const unavailable = { predicted_value: null, confidence: null, recommendation: null, error_margin: null, status: 'unavailable' };

  // Only props with a posted line get a prediction; the books behind each
  // line travel along as the market summary the edge model and tracker use
  const lines = {};
  const markets = {};
  const books = {};
  for (const propType of propTypes) {
    const prop = allProps[propType];
    if (!prop || prop.status === 'unavailable' || !prop.line) predictions[propType] = unavailable;
    else {
      lines[propType] = prop.line;
      markets[propType] = summarizeMarket(prop);
      books[propType] = prop;
    }
  }
  if (Object.keys(lines).length === 0 || !games || games.length < 3) {
    for (const propType of Object.keys(lines)) predictions[propType] = { ...unavailable, error: 'Insufficient game data' };
    return predictions;
  }

  // One feature build and one model process for every prop
  let results = {};
  try {
    results = await predictPropsFromGames(games, playerName, lines, nextGameInfo, injuryData, { markets, books, gameSpread: options.gameSpread || null });
  } catch (error) {
    console.error('❌ Error generating prop predictions:', error.message);
  }

  for (const [propType, vegasLine] of Object.entries(lines)) {
    const prediction = results[propType];
    if (!prediction) {
      predictions[propType] = { ...unavailable, status: null, error: 'Prediction generation failed' };
      continue;
    }
    const predictedValue = prediction[`predicted_${propType}`] ?? prediction.predicted_value ?? null;
    predictions[propType] = {
      predicted_value: predictedValue,
      confidence: prediction.confidence || null,
      recommendation: prediction.recommendation || null,
      over_probability: prediction.over_probability ?? null,
      error_margin: prediction.error_margin ?? null,
      analysis: prediction.analysis || null,
      stats: prediction.stats || null,
      model_value: prediction.model_value ?? null,
      betting_line: vegasLine,
      best_bet: prediction.best_bet ?? null,
      book_edges: prediction.book_edges ?? null
    };
  }
  return predictions;
}
