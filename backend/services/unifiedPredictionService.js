import dotenv from 'dotenv';
import { storePrediction, getPlayerBias } from './predictionTrackingService.js';
import { predictProp as mlPredictProp, areModelsAvailable } from '../ml/mlPredictionService.js';

dotenv.config();

/**
 * Prop type mapping to standardized format
 */
const PROP_TYPE_MAP = {
  'points': 'PTS',
  'rebounds': 'REB',
  'assists': 'AST',
  'steals': 'STL',
  'blocks': 'BLK',
  'threes': '3PM',
  'threes_made': '3PM',
  'turnovers': 'TO',
  'points_rebounds': 'PR',  // Points + Rebounds
  'points_assists': 'PA',   // Points + Assists
  'rebounds_assists': 'RA', // Rebounds + Assists
  'points_rebounds_assists': 'PRA' // Points + Rebounds + Assists
};

/**
 * Get the stat value for a specific prop type from a game
 */
export function getPropValue(game, propType) {
  switch (propType) {
    case 'points':
      return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
    case 'assists':
      return typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
    case 'rebounds':
      return typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
    case 'steals':
      return typeof game.steals === 'number' ? game.steals : parseFloat(game.steals) || 0;
    case 'blocks':
      return typeof game.blocks === 'number' ? game.blocks : parseFloat(game.blocks) || 0;
    case 'threes':
    case 'threes_made':
      return typeof game.threes === 'number' ? game.threes : 
             typeof game.threes_made === 'number' ? game.threes_made :
             parseFloat(game.threes || game.threes_made) || 0;
    case 'turnovers':
      return typeof game.turnovers === 'number' ? game.turnovers : parseFloat(game.turnovers) || 0;
    case 'pr':
    case 'points_rebounds':
      const pts1 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
      const reb1 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
      return pts1 + reb1;
    case 'pa':
    case 'points_assists':
      const pts2 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
      const ast1 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
      return pts2 + ast1;
    case 'ra':
    case 'rebounds_assists':
      const reb2 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
      const ast2 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
      return reb2 + ast2;
    case 'pra':
    case 'points_rebounds_assists':
      const pts3 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
      const reb3 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
      const ast3 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
      return pts3 + reb3 + ast3;
    default:
      return 0;
  }
}

/**
 * Parse minutes from various formats
 */
function parseMinutes(mins) {
  if (!mins || mins === '0' || mins === 0) return null;
  if (typeof mins === 'number') return mins;
  if (typeof mins === 'string') {
    if (mins.includes(':')) {
      const parts = mins.split(':');
      const minutes = parseInt(parts[0]) || 0;
      const seconds = parseInt(parts[1]) || 0;
      return minutes + (seconds / 60);
    }
    const parsed = parseFloat(mins);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Get player injury status from injury data
 */
function getPlayerInjuryStatus(injuryData, playerName) {
  if (!injuryData || !injuryData.playerTeamInjuries) {
    return { status: 'active', description: '', minutesReduction: 0 };
  }

  const playerInjury = injuryData.playerTeamInjuries.find(
    inj => inj.playerName && playerName && 
    inj.playerName.toLowerCase().includes(playerName.toLowerCase().split(' ').pop())
  );

  if (!playerInjury) {
    return { status: 'active', description: '', minutesReduction: 0 };
  }

  const statusLower = (playerInjury.status || '').toLowerCase();
  const description = (playerInjury.description || playerInjury.comment || '').toLowerCase();

  let status = 'active';
  let minutesReduction = 0;

  if (statusLower.includes('out') || statusLower.includes('doubtful')) {
    status = 'out';
    minutesReduction = 100;
  } else if (statusLower.includes('questionable')) {
    if (description.includes('expected to play') || description.includes('probable') || description.includes('likely to play')) {
      status = 'questionable';
      minutesReduction = 5;
    } else {
      status = 'questionable';
      minutesReduction = 10;
    }
  } else if (statusLower.includes('limited') || description.includes('minute restriction') || description.includes('limited minutes')) {
    status = 'limited';
    const minutesMatch = description.match(/(\d+)\s*min/i);
    if (minutesMatch) {
      const restrictedMins = parseInt(minutesMatch[1]);
      minutesReduction = Math.max(10, Math.min(20, 100 - (restrictedMins / 35) * 100));
    } else {
      minutesReduction = 15;
    }
  } else {
    status = 'active';
    minutesReduction = 0;
  }

  return { status, description: playerInjury.description || playerInjury.comment || '', minutesReduction };
}

/**
 * Format opponent injuries as comma-separated list with statuses
 * Also detects missing key defenders and adds contextual notes
 */
function formatOpponentInjuries(opponentInjuries, propType) {
  if (!opponentInjuries || opponentInjuries.length === 0) {
    return 'none';
  }

  // Format as "Player Name (status), Player Name (status)"
  const injuryList = opponentInjuries.map(inj => {
    const name = inj.playerName || 'Unknown';
    const status = (inj.status || 'out').toLowerCase();
    // Normalize status for display
    let displayStatus = 'out';
    if (status.includes('questionable')) {
      displayStatus = 'questionable';
    } else if (status.includes('doubtful')) {
      displayStatus = 'doubtful';
    } else if (status.includes('active') || status.includes('probable')) {
      displayStatus = 'active';
    }
    return `${name} (${displayStatus})`;
  });

  // Detect missing key defenders (prop-specific)
  const contextualNotes = [];
  const highImpactInjuries = opponentInjuries.filter(inj => (inj.impactScore || 0) >= 70);
  
  // For REBOUNDS: Check for missing rim protector/bigs
  if (propType === 'rebounds' || propType === 'points_rebounds' || propType === 'rebounds_assists' || propType === 'points_rebounds_assists') {
    const missingRimProtector = opponentInjuries.some(inj => {
      const pos = (inj.position || '').toUpperCase();
      return (pos === 'C' || pos.includes('CENTER') || pos === 'PF') && (inj.impactScore || 0) >= 70;
    });
    if (missingRimProtector) {
      contextualNotes.push('missing rim protector');
    }
  }

  // For ASSISTS: Check for missing PG defenders
  if (propType === 'assists' || propType === 'points_assists' || propType === 'rebounds_assists' || propType === 'points_rebounds_assists') {
    const hasStartingPG = opponentInjuries.some(inj => {
      const pos = (inj.position || '').toUpperCase();
      return pos === 'PG' && (inj.impactScore || 0) >= 70;
    });
    if (hasStartingPG) {
      contextualNotes.push('missing starting PG');
    }
  }

  // For POINTS/3PM: Check for missing perimeter defenders
  if (propType === 'points' || propType === 'threes' || propType === 'threes_made' || propType === 'points_assists' || propType === 'points_rebounds' || propType === 'points_rebounds_assists') {
    const hasTopPerimeterDefender = opponentInjuries.some(inj => {
      const pos = (inj.position || '').toUpperCase();
      return (pos === 'SG' || pos === 'SF' || pos.includes('GUARD') || pos.includes('FORWARD')) && 
             (inj.impactScore || 0) >= 80;
    });
    if (hasTopPerimeterDefender) {
      contextualNotes.push('missing top perimeter defender');
    }
  }

  // Check for multiple starters (high impact players)
  if (highImpactInjuries.length >= 2) {
    contextualNotes.push('missing two starters');
  }

  // Check for blowout risk (3+ high impact players out)
  if (highImpactInjuries.length >= 3) {
    contextualNotes.push('possible blowout risk');
  }

  // Combine injury list with contextual notes
  let result = injuryList.join(', ');
  if (contextualNotes.length > 0) {
    result += `; ${contextualNotes.join(', ')}`;
  }

  return result;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Generate natural language analysis for any prop prediction
 * @param {number} predictedValue - The predicted value
 * @param {number|null} vegasLine - The Vegas betting line
 * @param {object} stats - Stats object with overall_avg, recent_3_avg, recent_5_avg, volatility, std_dev
 * @param {string} propType - The prop type (e.g., 'points', 'rebounds', 'assists')
 * @returns {string} Natural language analysis
 */
function generateAnalysis(predictedValue, vegasLine, stats, propType, coverProbability = null) {
  const { overall_avg, recent_3_avg, recent_5_avg, volatility, std_dev } = stats;
  
  // Get prop display name for combined stats
  const isCombinedProp = propType === 'points_rebounds' || propType === 'points_assists' || 
                         propType === 'rebounds_assists' || propType === 'points_rebounds_assists';
  
  const combinedPropNames = {
    'points_rebounds': 'points and rebounds',
    'points_assists': 'points and assists',
    'rebounds_assists': 'rebounds and assists',
    'points_rebounds_assists': 'points, rebounds, and assists'
  };
  
  // For combined props, use "combined stat" terminology
  const propNameSingular = isCombinedProp ? 'combined stat' : 
                           propType === 'points' ? 'point' : 
                           propType === 'rebounds' ? 'rebound' :
                           propType === 'assists' ? 'assist' :
                           propType === 'steals' ? 'steal' :
                           propType === 'blocks' ? 'block' :
                           propType === 'threes' || propType === 'threes_made' ? 'three-pointer' :
                           propType === 'turnovers' ? 'turnover' :
                           propType;
  
  const propNamePlural = isCombinedProp ? 'combined stats' :
                         propType === 'points' ? 'points' :
                         propType === 'rebounds' ? 'rebounds' :
                         propType === 'assists' ? 'assists' :
                         propType === 'steals' ? 'steals' :
                         propType === 'blocks' ? 'blocks' :
                         propType === 'threes' || propType === 'threes_made' ? 'three-pointers' :
                         propType === 'turnovers' ? 'turnovers' :
                         propType;
  
  // Build analysis sentences
  const sentences = [];
  
  // Opening sentence with prediction
  if (isCombinedProp) {
    sentences.push(`The model projects ${predictedValue.toFixed(1)} ${combinedPropNames[propType]} for the upcoming game.`);
  } else {
    sentences.push(`The model projects ${predictedValue.toFixed(1)} ${propNamePlural} for the upcoming game.`);
  }
  
  // Analyze trend: recent_3_avg vs season_avg (overall_avg)
  // This is the primary trend analysis based on user requirements
  if (recent_3_avg !== null && recent_3_avg !== undefined && overall_avg !== null && overall_avg !== undefined && overall_avg > 0) {
    const percentDiff = ((recent_3_avg - overall_avg) / overall_avg) * 100;
    
    // Rule 1: recent_3_avg > season_avg by +5% or more
    if (percentDiff >= 5) {
      // Describe as upswing, positive momentum, or above-trend scoring
      const trendPhrases = [
        { phrase: 'upswing', article: 'an' },
        { phrase: 'positive momentum', article: 'a' },
        { phrase: 'above-trend scoring', article: 'an' }
      ];
      const trend = trendPhrases[Math.floor(Math.random() * trendPhrases.length)];
      
      if (isCombinedProp) {
        sentences.push(`Recent performance shows ${trend.article} ${trend.phrase}, with ${recent_3_avg.toFixed(1)} ${combinedPropNames[propType]} in the last 3 games compared to the season average of ${overall_avg.toFixed(1)}.`);
      } else {
        sentences.push(`Recent performance shows ${trend.article} ${trend.phrase}, with ${recent_3_avg.toFixed(1)} ${propNamePlural} in the last 3 games compared to the season average of ${overall_avg.toFixed(1)}.`);
      }
      
      // Only mention regression if explicitly stating it as mild regression toward average
      // Check if prediction is below recent_3_avg, suggesting the model accounts for some regression
      if (predictedValue < recent_3_avg) {
        if (isCombinedProp) {
          sentences.push(`There may be mild regression toward the season average, which is reflected in this projection.`);
        } else {
          sentences.push(`There may be mild regression toward the season average, which is reflected in this projection.`);
        }
      }
    }
    // Rule 2: recent_3_avg is within ±5% of season_avg
    else if (percentDiff > -5 && percentDiff < 5) {
      // Describe as consistent with season norms or in line with typical performance
      const consistencyPhrases = ['consistent with season norms', 'in line with typical performance'];
      const consistencyPhrase = consistencyPhrases[Math.floor(Math.random() * consistencyPhrases.length)];
      
      if (isCombinedProp) {
        sentences.push(`Recent form (${recent_3_avg.toFixed(1)} ${combinedPropNames[propType]} in last 3 games) is ${consistencyPhrase} (season average: ${overall_avg.toFixed(1)}).`);
      } else {
        sentences.push(`Recent form (${recent_3_avg.toFixed(1)} ${propNamePlural} in last 3 games) is ${consistencyPhrase} (season average: ${overall_avg.toFixed(1)}).`);
      }
      // DO NOT mention regression for this case
    }
    // Rule 3: recent_3_avg < season_avg by -5% or more
    else {
      // Describe as slight downturn, below-trend performance, or recent dip
      const downturnPhrases = [
        { phrase: 'slight downturn', article: 'a' },
        { phrase: 'below-trend performance', article: 'a' },
        { phrase: 'recent dip', article: 'a' }
      ];
      const downturn = downturnPhrases[Math.floor(Math.random() * downturnPhrases.length)];
      
      if (isCombinedProp) {
        sentences.push(`Recent performance shows ${downturn.article} ${downturn.phrase}, with ${recent_3_avg.toFixed(1)} ${combinedPropNames[propType]} in the last 3 games compared to the season average of ${overall_avg.toFixed(1)}.`);
      } else {
        sentences.push(`Recent performance shows ${downturn.article} ${downturn.phrase}, with ${recent_3_avg.toFixed(1)} ${propNamePlural} in last 3 games compared to the season average of ${overall_avg.toFixed(1)}.`);
      }
      
      // Only mention regression if clearly stated as positive regression toward average
      // Check if prediction is above recent_3_avg, suggesting the model accounts for positive regression
      if (predictedValue > recent_3_avg) {
        if (isCombinedProp) {
          sentences.push(`The projection accounts for possible positive regression upward toward the season average.`);
        } else {
          sentences.push(`The projection accounts for possible positive regression upward toward the season average.`);
        }
      }
    }
    
    // Add recent 5-game context if available
    if (recent_5_avg !== null && recent_5_avg !== undefined) {
      if (isCombinedProp) {
        sentences.push(`Over the last 5 games, the player has averaged ${recent_5_avg.toFixed(1)} ${combinedPropNames[propType]}.`);
      } else {
        sentences.push(`Over the last 5 games, the player has averaged ${recent_5_avg.toFixed(1)} ${propNamePlural}.`);
      }
    }
  }
  // Fallback: if we don't have recent_3_avg, compare prediction to season average
  else if (overall_avg !== null && overall_avg !== undefined) {
    const avgDiff = predictedValue - overall_avg;
    if (Math.abs(avgDiff) < 0.5) {
      if (isCombinedProp) {
        sentences.push(`This aligns closely with the player's season average of ${overall_avg.toFixed(1)} ${combinedPropNames[propType]}.`);
      } else {
        sentences.push(`This aligns closely with the player's season average of ${overall_avg.toFixed(1)} ${propNamePlural}.`);
      }
    } else if (avgDiff > 0) {
      if (isCombinedProp) {
        sentences.push(`This is above the player's season average of ${overall_avg.toFixed(1)} ${combinedPropNames[propType]}.`);
      } else {
        sentences.push(`This is above the player's season average of ${overall_avg.toFixed(1)} ${propNamePlural}.`);
      }
    } else {
      if (isCombinedProp) {
        sentences.push(`This is below the player's season average of ${overall_avg.toFixed(1)} ${combinedPropNames[propType]}.`);
      } else {
        sentences.push(`This is below the player's season average of ${overall_avg.toFixed(1)} ${propNamePlural}.`);
      }
    }
  }
  
  // Reference to volatility/consistency
  if (volatility !== null && volatility !== undefined) {
    if (volatility < 20) {
      sentences.push(`The player has shown consistent performance with low volatility (${volatility.toFixed(1)}%), increasing confidence in this prediction.`);
    } else if (volatility < 40) {
      sentences.push(`Moderate volatility (${volatility.toFixed(1)}%) indicates some variability, which is considered in the projection.`);
    } else {
      sentences.push(`High volatility (${volatility.toFixed(1)}%) suggests significant game-to-game variation, making this prediction more uncertain.`);
    }
  }
  
  // Reference to Vegas line with cover probability if available
  if (vegasLine !== null && vegasLine !== undefined) {
    const lineDiff = predictedValue - vegasLine;

    // Add cover probability context if available
    if (coverProbability !== null && coverProbability !== undefined) {
      if (coverProbability > 55) {
        sentences.push(`With a ${coverProbability.toFixed(1)}% probability of hitting the over on the ${vegasLine.toFixed(1)} line, this represents strong value on the OVER.`);
      } else if (coverProbability < 45) {
        sentences.push(`With a ${coverProbability.toFixed(1)}% probability of hitting the over on the ${vegasLine.toFixed(1)} line, this suggests value on the UNDER.`);
      } else {
        sentences.push(`The ${coverProbability.toFixed(1)}% probability of hitting the over on the ${vegasLine.toFixed(1)} line indicates this is close to a coin flip.`);
      }
    } else {
      // Fallback if cover probability not available
      if (Math.abs(lineDiff) < 0.5) {
        sentences.push(`This projection closely matches the Vegas line of ${vegasLine.toFixed(1)}.`);
      } else if (lineDiff > 0) {
        sentences.push(`The model projects above the Vegas line of ${vegasLine.toFixed(1)}.`);
      } else {
        sentences.push(`The model projects below the Vegas line of ${vegasLine.toFixed(1)}.`);
      }
    }
  }

  // Join sentences with proper spacing
  return sentences.join(' ');
}

/**
 * Calculate confidence level from prediction vs vegas line
 */
function calculateConfidenceLevel(predictedValue, vegasLine) {
  if (!vegasLine) return 'Medium';
  
  const diff = Math.abs(predictedValue - vegasLine);
  const diffPercent = (diff / vegasLine) * 100;
  
  // Small difference = high confidence
  if (diffPercent <= 5) return 'High';
  // Moderate difference = medium confidence
  if (diffPercent <= 15) return 'Medium';
  // Large difference = low confidence
  return 'Low';
}

/**
 * Calculate error margin from volatility (2.0 to 6.0)
 */
function calculateErrorMargin(volatility) {
  if (volatility < 20) {
    return 2.0 + (volatility / 20) * 1.0; // 2.0 to 3.0
  } else if (volatility < 50) {
    return 3.0 + ((volatility - 20) / 30) * 1.5; // 3.0 to 4.5
  } else {
    return 4.5 + Math.min((volatility - 50) / 50, 1.0) * 1.5; // 4.5 to 6.0
  }
}

/**
 * Error function approximation for normal distribution
 */
function erf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Calculate cover probability using normal distribution
 */
function calculateCoverProbability(prediction, line, stdDev) {
  if (!prediction || !line) return null;

  // Use stdDev as error margin, or estimate if not available
  const errorMargin = stdDev || Math.max(2, Math.abs(prediction - line) * 0.3);

  // Calculate z-score for OVER probability
  const zScore = (prediction - line) / errorMargin;

  // P(X > line) using cumulative distribution function
  const probability = 0.5 * (1 + erf(zScore / Math.sqrt(2)));

  return Math.max(0, Math.min(1, probability)) * 100; // Return as percentage
}

/**
 * Calculate recommendation based on cover probability (not just mean prediction)
 * This accounts for volatility and actual hit probability
 */
function calculateRecommendation(predictedValue, vegasLine, stdDev = null) {
  if (!vegasLine) return null;

  // Calculate cover probability accounting for volatility
  const coverProbability = calculateCoverProbability(predictedValue, vegasLine, stdDev);

  if (!coverProbability) return null;

  // Recommend OVER if cover probability > 55% (accounting for vig)
  if (coverProbability > 55) return 'OVER';

  // Recommend UNDER if cover probability < 45% (accounting for vig)
  if (coverProbability < 45) return 'UNDER';

  // No strong recommendation if probability is between 45-55%
  return null;
}

/**
 * Build prop-specific features from game history for prediction pipeline
 */
function buildPropFeatures(games, playerName, propType, nextGameInfo, injuryData, bettingLine) {
  const chronologicalGames = [...games].reverse();
  const valuesArray = chronologicalGames.map(g => getPropValue(g, propType));

  const avgValue = valuesArray.reduce((a, b) => a + b, 0) / valuesArray.length;
  const stdDev = calculateStdDev(valuesArray);
  const volatility = avgValue > 0 ? (stdDev / avgValue) * 100 : 0;

  const recent3Count = Math.min(3, valuesArray.length);
  const recent5Count = Math.min(5, valuesArray.length);
  const recent3Avg = valuesArray.slice(-recent3Count).reduce((a, b) => a + b, 0) / recent3Count;
  const recent5Avg = valuesArray.slice(-recent5Count).reduce((a, b) => a + b, 0) / recent5Count;

  // Injury status
  const playerInjury = getPlayerInjuryStatus(injuryData, playerName);

  // Format opponent injuries
  const oppInjuries = injuryData?.opponentInjuries || [];
  const oppInjuriesFormatted = formatOpponentInjuries(oppInjuries, propType);

  return {
    playerName,
    propType,
    vegasLine: bettingLine || null,
    recentAvg3: Math.round(recent3Avg * 10) / 10,
    recentAvg5: Math.round(recent5Avg * 10) / 10,
    seasonAvg: Math.round(avgValue * 10) / 10,
    injuryStatus: playerInjury.status,
    oppInjuries: oppInjuriesFormatted,
    gamesCount: games.length,
    volatility: Math.round(volatility * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    nextGameInfo
  };
}

/**
 * Predict any prop type from games array using XGBoost models
 * This is the UNIFIED prediction function for ALL props
 */
export async function predictPropFromGames(games, playerName, propType = 'points', nextGameInfo = null, injuryData = null, bettingLine = null) {
  if (!games || games.length < 3) {
    throw new Error(`Insufficient game data for prediction. Need at least 3 games, got ${games?.length || 0}.`);
  }

  const propTypeFormatted = PROP_TYPE_MAP[propType] || propType.toUpperCase();
  try {
    // Step 1: Build prop-specific features
    const features = buildPropFeatures(games, playerName, propType, nextGameInfo, injuryData, bettingLine);

    // Step 2: Handle OUT players immediately
    if (features.injuryStatus === 'out') {
      
      // Build stats object for analysis
      const statsForAnalysis = {
        overall_avg: features.seasonAvg,
        recent_3_avg: features.recentAvg3,
        recent_5_avg: features.recentAvg5,
        volatility: features.volatility,
        std_dev: features.stdDev
      };
      
      // Generate analysis even for OUT players (explains why prediction is 0)
      const analysis = `The player is currently listed as out and will not play in the upcoming game. This prediction reflects that status.`;
      
      return {
        player: playerName,
        [`predicted_${propType}`]: 0,
        predicted_points: propType === 'points' ? 0 : null,
        analysis: analysis,
        confidence: 'High',
        error_margin: 0,
        recommendation: null,
        games_used: games.length,
        method: 'player_out',
        prop_type: propType,
        stats: statsForAnalysis
      };
    }

    // Step 3: Generate numeric prediction using XGBoost ML models
    let predictedValue;
    let predictionMethod = 'xgboost_model';
    let mlFeatureVector = null;

    const mlModelsAvailable = areModelsAvailable();
    if (mlModelsAvailable) {
      try {
        const mlResult = await mlPredictProp(games, propTypeFormatted);
        predictedValue = mlResult.prediction;
        mlFeatureVector = mlResult.features;
      } catch (mlError) {
        console.error(`ML model failed for ${propTypeFormatted}: ${mlError.message}`);
        predictedValue = features.recentAvg3 * 0.5 + features.recentAvg5 * 0.3 + features.seasonAvg * 0.2;
        predictionMethod = 'statistical_fallback';
      }
    } else {
      predictedValue = features.recentAvg3 * 0.5 + features.recentAvg5 * 0.3 + features.seasonAvg * 0.2;
      predictionMethod = 'statistical_fallback';
    }

    // Step 4: Apply recent form blending when there's significant deviation from model output.
    // The ML model regresses toward season averages, so we blend 30% toward the
    // recent 3-game average when it diverges by more than 2 points. This ensures
    // hot/cold streaks are reflected in the projection (capped at ±5 point adjustment).
    let finalPredictedValue = predictedValue;
    const recentAvg3 = features.recentAvg3;
    const recentDeviation = recentAvg3 - predictedValue;

    if (Math.abs(recentDeviation) > 2 && recentAvg3 > 0) {
      const rawAdjustment = recentDeviation * 0.30;
      const adjustment = Math.sign(rawAdjustment) * Math.min(Math.abs(rawAdjustment), 5);
      finalPredictedValue = predictedValue + adjustment;
    }

    // Step 4b: Apply per-player bias correction from historical prediction errors.
    // If the model consistently over/under-predicts for this player, correct for it.
    const playerBias = getPlayerBias(playerName, propType);
    if (playerBias !== null) {
      const cappedBias = Math.sign(playerBias) * Math.min(Math.abs(playerBias), 5);
      finalPredictedValue += cappedBias;
    }

    // Step 5: Calculate confidence from |prediction - vegas_line|
    const confidenceLevel = calculateConfidenceLevel(finalPredictedValue, features.vegasLine);

    // Step 6: Calculate error margin from volatility (2.0 to 6.0)
    const errorMargin = calculateErrorMargin(features.volatility);

    // Step 7: Calculate recommendation using cover probability (accounts for volatility)
    const coverProbability = calculateCoverProbability(finalPredictedValue, features.vegasLine, features.stdDev);
    const recommendation = calculateRecommendation(finalPredictedValue, features.vegasLine, features.stdDev);

    // Step 8: Build result object
    // Ensure we always have the correct field name for the prop type
    const predictedFieldName = `predicted_${propType}`;
    const predictedValueRounded = Math.max(0, Math.round(finalPredictedValue * 10) / 10);
    
    // Build stats object for analysis
    const statsForAnalysis = {
      overall_avg: features.seasonAvg,
      recent_3_avg: features.recentAvg3,
      recent_5_avg: features.recentAvg5,
      volatility: features.volatility,
      std_dev: features.stdDev
    };
    
    // Generate natural language analysis using shared function (include cover probability)
    const analysis = generateAnalysis(finalPredictedValue, features.vegasLine, statsForAnalysis, propType, coverProbability);
    
    const predictionResult = {
      player: playerName,
      [predictedFieldName]: predictedValueRounded,
      // For backward compatibility, also include predicted_points if it's points
      predicted_points: propType === 'points' ? predictedValueRounded : null,
      analysis: analysis,
      confidence: confidenceLevel,
      error_margin: Math.round(errorMargin * 10) / 10,
      recommendation: recommendation,
      games_used: games.length,
      method: predictionMethod,
      prop_type: propType,
      stats: statsForAnalysis
    };
    
    // Store prediction for tracking (if next game info is available)
    if (nextGameInfo && nextGameInfo.date) {
      try {
        storePrediction(playerName, predictionResult, games, nextGameInfo, propType, mlFeatureVector);
      } catch (trackError) {
        console.warn('⚠️ Failed to store prediction for tracking:', trackError.message);
      }
    }

    return predictionResult;
  } catch (error) {
    console.error(`❌ [PIPELINE-${propTypeFormatted}] Prediction failed:`, error);
    throw new Error(`Prediction failed for ${propType}: ${error.message}`);
  }
}

