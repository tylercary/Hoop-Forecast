import dotenv from 'dotenv';
import { storePrediction, getPlayerBias } from './predictionTrackingService.js';
import { predictProp as mlPredictProp, buildMLFeatures } from '../ml/mlPredictionService.js';
import { buildMatchupFeatures, getMatchupEdge, resolveOpponentAbbrev } from './opponentMatchupService.js';

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
function generateAnalysis(predictedValue, vegasLine, stats, propType, coverProbability = null, extras = {}) {
  const { overall_avg, recent_3_avg, recent_5_avg, volatility, std_dev } = stats;
  const { matchupImpact, opponent, recommendation, confidence, injuryContext } = extras;
  
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
  
  // Matchup context
  if (opponent && matchupImpact != null && Math.abs(matchupImpact) > 0.1) {
    if (matchupImpact > 0.3) {
      sentences.push(`The matchup against ${opponent} is favorable — their defense ranks below average in this category, boosting the projection.`);
    } else if (matchupImpact > 0.1) {
      sentences.push(`The matchup against ${opponent} provides a slight edge, as their defense is somewhat permissive in this area.`);
    } else if (matchupImpact < -0.3) {
      sentences.push(`The matchup against ${opponent} is tough — their defense is elite in this category, pulling the projection down.`);
    } else if (matchupImpact < -0.1) {
      sentences.push(`The matchup against ${opponent} is slightly unfavorable, as their defense ranks above average here.`);
    }
  } else if (opponent) {
    sentences.push(`The matchup against ${opponent} is neutral and doesn't significantly shift the projection.`);
  }

  // Injury context
  if (injuryContext) {
    sentences.push(injuryContext);
  }

  // Reference to Vegas line with cover probability and recommendation
  if (vegasLine !== null && vegasLine !== undefined) {
    if (coverProbability !== null && coverProbability !== undefined) {
      if (recommendation === 'OVER') {
        sentences.push(`The model sees ${coverProbability.toFixed(0)}% over probability on the ${vegasLine.toFixed(1)} line — recommending OVER.`);
      } else if (recommendation === 'UNDER') {
        sentences.push(`The model sees only ${coverProbability.toFixed(0)}% over probability on the ${vegasLine.toFixed(1)} line — recommending UNDER.`);
      } else {
        sentences.push(`At ${coverProbability.toFixed(0)}% over probability on the ${vegasLine.toFixed(1)} line, there's no clear edge — no strong recommendation.`);
      }
    } else {
      const lineDiff = predictedValue - vegasLine;
      if (Math.abs(lineDiff) < 0.5) {
        sentences.push(`This projection closely matches the Vegas line of ${vegasLine.toFixed(1)}.`);
      } else if (lineDiff > 0) {
        sentences.push(`The model projects above the Vegas line of ${vegasLine.toFixed(1)}.`);
      } else {
        sentences.push(`The model projects below the Vegas line of ${vegasLine.toFixed(1)}.`);
      }
    }
  }

  return sentences.join(' ');
}

/**
 * Calculate confidence level — how confident are we in our edge over the line.
 * Larger deviation from Vegas + low volatility = higher confidence.
 */
function calculateConfidenceLevel(predictedValue, vegasLine, volatility = 30) {
  if (!vegasLine) return 'Medium';

  const diff = Math.abs(predictedValue - vegasLine);
  const diffPercent = (diff / vegasLine) * 100;

  // No meaningful edge over Vegas
  if (diffPercent < 3) return 'Low';

  // Factor in volatility: low vol = more trustworthy edge
  if (volatility < 25) {
    return diffPercent >= 8 ? 'High' : 'Medium';
  } else if (volatility < 45) {
    return diffPercent >= 12 ? 'High' : 'Medium';
  } else {
    // High volatility — only high confidence with very large edge
    return diffPercent >= 18 ? 'High' : diffPercent >= 10 ? 'Medium' : 'Low';
  }
}

/**
 * Calculate error margin from volatility and season average.
 * Scales with stat magnitude so low-value props (threes, steals, blocks)
 * get proportionally tighter margins than high-value props (points, PRA).
 *
 * Base margin = seasonAvg * percentage (15%-30% depending on volatility),
 * with a floor of 1.0 and a cap of 6.0.
 */
function calculateErrorMargin(volatility, seasonAvg = 20) {
  // Percentage of season average to use as margin
  let pct;
  if (volatility < 20) {
    pct = 0.15 + (volatility / 20) * 0.05; // 15% to 20%
  } else if (volatility < 50) {
    pct = 0.20 + ((volatility - 20) / 30) * 0.05; // 20% to 25%
  } else {
    pct = 0.25 + Math.min((volatility - 50) / 50, 1.0) * 0.05; // 25% to 30%
  }

  const margin = seasonAvg * pct;
  return Math.max(1.0, Math.min(margin, 6.0));
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
function buildPropFeatures(games, playerName, propType, nextGameInfo, injuryData, bettingLine, matchupFeatures = null) {
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
    nextGameInfo,
    matchupFeatures: matchupFeatures || null
  };
}

/**
 * Calculate over/under confidence using matchup-enhanced analysis.
 * Combines statistical cover probability with matchup edge for a refined confidence score.
 *
 * @param {number} prediction - Predicted stat value
 * @param {number} line - Betting line
 * @param {number} stdDev - Standard deviation of player's recent stats
 * @param {number} matchupEdge - Matchup edge score from opponent analysis (-1 to 1)
 * @param {number} volatility - Player volatility percentage
 * @returns {Object} { overProbability, confidence, recommendation, edgeStrength }
 */
function calculateEnhancedOverUnder(prediction, line, stdDev, matchupEdge = 0, volatility = 30) {
  if (!prediction || !line) {
    return { overProbability: 50, confidence: 'Low', recommendation: null, edgeStrength: 0 };
  }

  // Base cover probability from statistical model
  const baseCoverProb = calculateCoverProbability(prediction, line, stdDev) || 50;

  // Matchup adjustment: shift probability based on opponent context
  // matchupEdge ranges roughly -0.3 to +0.3; scale to probability points
  const matchupShift = matchupEdge * 8; // ±2.4 percentage points typical

  // Combine: base statistical probability + matchup context
  const adjustedProb = Math.max(5, Math.min(95, baseCoverProb + matchupShift));

  // Edge strength: how far from 50/50 is this pick? (0-50 scale)
  const edgeStrength = Math.abs(adjustedProb - 50);

  // Confidence tiers based on edge strength + volatility
  let confidence;
  if (edgeStrength >= 15 && volatility < 35) {
    confidence = 'High';
  } else if (edgeStrength >= 8) {
    confidence = 'Medium';
  } else {
    confidence = 'Low';
  }

  // Recommendation: only recommend when there's meaningful edge
  // Tighter thresholds (58/42) reduce false recommendations
  let recommendation = null;
  if (adjustedProb > 58) recommendation = 'OVER';
  else if (adjustedProb < 42) recommendation = 'UNDER';

  return {
    overProbability: Math.round(adjustedProb * 10) / 10,
    confidence,
    recommendation,
    edgeStrength: Math.round(edgeStrength * 10) / 10,
    matchupImpact: Math.round(matchupShift * 10) / 10,
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
    // Step 1: Fetch opponent matchup features (non-blocking — falls back to null)
    let matchupFeatures = null;
    let matchupEdge = 0;
    let opponentAbbrev = null;

    if (nextGameInfo) {
      try {
        // Determine player's team from recent games
        const lastGame = games[0];
        const playerTeam = lastGame?.team || lastGame?.teamAbbrev || null;
        opponentAbbrev = resolveOpponentAbbrev(nextGameInfo, playerTeam);

        if (opponentAbbrev) {
          matchupFeatures = await buildMatchupFeatures(opponentAbbrev, propType);
          matchupEdge = getMatchupEdge(matchupFeatures, propType);
        }
      } catch (matchupErr) {
        console.warn('[Matchup] Failed to build matchup features:', matchupErr.message);
      }
    }

    // Step 2: Build prop-specific features
    const features = buildPropFeatures(games, playerName, propType, nextGameInfo, injuryData, bettingLine, matchupFeatures);

    // Step 3: Handle OUT players immediately
    if (features.injuryStatus === 'out') {
      const statsForAnalysis = {
        overall_avg: features.seasonAvg,
        recent_3_avg: features.recentAvg3,
        recent_5_avg: features.recentAvg5,
        volatility: features.volatility,
        std_dev: features.stdDev
      };

      const analysis = `The player is currently listed as out and will not play in the upcoming game. This prediction reflects that status.`;

      return {
        player: playerName,
        [`predicted_${propType}`]: 0,
        predicted_points: propType === 'points' ? 0 : null,
        analysis: analysis,
        confidence: 'High',
        error_margin: 0,
        recommendation: null,
        over_probability: null,
        edge_strength: 0,
        matchup_impact: 0,
        games_used: games.length,
        method: 'player_out',
        prop_type: propType,
        stats: statsForAnalysis
      };
    }

    // Step 4: Generate numeric prediction using XGBoost ML models
    let predictedValue;
    let predictionMethod = 'xgboost_model';
    let mlFeatureVector = null;

    try {
      mlFeatureVector = buildMLFeatures(games, propTypeFormatted);
    } catch (featErr) {
      console.warn('Could not compute feature vector:', featErr.message);
    }

    const mlResult = await mlPredictProp(games, propTypeFormatted);
    predictedValue = mlResult.prediction;
    mlFeatureVector = mlResult.features;

    // Step 5: Dynamic recent form blending — scale by volatility.
    let finalPredictedValue = predictedValue;
    const recentAvg3 = features.recentAvg3;
    const recentDeviation = recentAvg3 - predictedValue;
    const vol = features.volatility || 0;

    if (Math.abs(recentDeviation) > 1.5 && recentAvg3 > 0) {
      const blendRatio = vol < 15 ? 0.15 : vol > 50 ? 0.45 : 0.15 + (vol - 15) / 35 * 0.30;
      const maxCap = Math.max(3, features.seasonAvg * 0.15);
      const rawAdjustment = recentDeviation * blendRatio;
      const adjustment = Math.sign(rawAdjustment) * Math.min(Math.abs(rawAdjustment), maxCap);
      finalPredictedValue = predictedValue + adjustment;
    }

    // Step 5b: Apply matchup adjustment to predicted value.
    // Scale matchup edge by season average to get absolute adjustment.
    if (matchupEdge !== 0 && features.seasonAvg > 0) {
      const matchupAdjustment = matchupEdge * features.seasonAvg * 0.08; // ~8% of season avg max
      const cappedMatchupAdj = Math.sign(matchupAdjustment) * Math.min(Math.abs(matchupAdjustment), features.seasonAvg * 0.1);
      finalPredictedValue += cappedMatchupAdj;
    }

    // Step 5c: Apply per-player bias correction from historical prediction errors.
    const playerBias = getPlayerBias(playerName, propType);
    if (playerBias !== null) {
      const cappedBias = Math.sign(playerBias) * Math.min(Math.abs(playerBias), 5);
      finalPredictedValue += cappedBias;
    }

    // Step 5d: Vegas line anchoring — blend model prediction with the betting line.
    // Vegas lines for player props carry significant information. Blend toward the
    // line to reduce overconfident deviations while preserving genuine model edge.
    // Use 30% Vegas / 70% model (less weight than game-level since player prop
    // lines are set with less precision than game spreads).
    if (features.vegasLine && features.vegasLine > 0) {
      const modelDeviation = Math.abs(finalPredictedValue - features.vegasLine);
      const seasonAvg = features.seasonAvg || features.vegasLine;
      const deviationPct = seasonAvg > 0 ? (modelDeviation / seasonAvg) * 100 : 0;

      // Only anchor when model deviates significantly (>15% from season avg)
      // Small deviations likely reflect real edge; large ones are often noise
      if (deviationPct > 15) {
        // Stronger anchoring for larger deviations (more likely to be model noise)
        const vegasWeight = Math.min(0.40, 0.25 + (deviationPct - 15) * 0.005);
        finalPredictedValue = finalPredictedValue * (1 - vegasWeight) + features.vegasLine * vegasWeight;
      }
    }

    // Step 6: Enhanced over/under classifier with matchup context
    const ouResult = calculateEnhancedOverUnder(
      finalPredictedValue, features.vegasLine, features.stdDev, matchupEdge, features.volatility
    );

    // Step 7: Calculate error margin from volatility
    const errorMargin = calculateErrorMargin(features.volatility, features.seasonAvg);

    // Step 8: Build result object
    const predictedFieldName = `predicted_${propType}`;
    const predictedValueRounded = Math.max(0, Math.round(finalPredictedValue * 10) / 10);

    const statsForAnalysis = {
      overall_avg: features.seasonAvg,
      recent_3_avg: features.recentAvg3,
      recent_5_avg: features.recentAvg5,
      volatility: features.volatility,
      std_dev: features.stdDev
    };

    // Build injury context for analysis
    let injuryContext = null;
    if (injuryData) {
      const keyInjuries = (injuryData.playerTeamInjuries || [])
        .filter(inj => inj.impactScore >= 80 && !inj.playerName?.toLowerCase().includes(playerName.toLowerCase().split(' ').pop()));
      const oppKeyInjuries = (injuryData.opponentInjuries || [])
        .filter(inj => inj.impactScore >= 80);

      if (keyInjuries.length > 0) {
        const names = keyInjuries.map(i => i.playerName).join(', ');
        injuryContext = `Key teammate${keyInjuries.length > 1 ? 's' : ''} ${names} ${keyInjuries.length > 1 ? 'are' : 'is'} out, which may increase usage and opportunity.`;
      }
      if (oppKeyInjuries.length > 0) {
        const names = oppKeyInjuries.map(i => i.playerName).join(', ');
        const oppContext = `Opponent is missing ${names}, which could affect the defensive matchup.`;
        injuryContext = injuryContext ? `${injuryContext} ${oppContext}` : oppContext;
      }
    }

    // Generate natural language analysis with full context
    const analysis = generateAnalysis(finalPredictedValue, features.vegasLine, statsForAnalysis, propType, ouResult.overProbability, {
      matchupImpact: ouResult.matchupImpact,
      opponent: opponentAbbrev,
      recommendation: ouResult.recommendation,
      confidence: ouResult.confidence,
      injuryContext
    });

    const predictionResult = {
      player: playerName,
      [predictedFieldName]: predictedValueRounded,
      predicted_points: propType === 'points' ? predictedValueRounded : null,
      analysis: analysis,
      confidence: ouResult.confidence,
      error_margin: Math.round(errorMargin * 10) / 10,
      recommendation: ouResult.recommendation,
      over_probability: ouResult.overProbability,
      edge_strength: ouResult.edgeStrength,
      matchup_impact: ouResult.matchupImpact,
      betting_line: features.vegasLine,
      games_used: games.length,
      method: predictionMethod,
      prop_type: propType,
      opponent: opponentAbbrev,
      stats: statsForAnalysis
    };

    // Store prediction for tracking (if next game info is available)
    if (nextGameInfo && nextGameInfo.date) {
      try {
        storePrediction(playerName, predictionResult, games, nextGameInfo, propType, mlFeatureVector);
      } catch (trackError) {
        console.warn('Failed to store prediction for tracking:', trackError.message);
      }
    }

    return predictionResult;
  } catch (error) {
    console.error(`[PIPELINE-${propTypeFormatted}] Prediction failed:`, error);
    throw new Error(`Prediction failed for ${propType}: ${error.message}`);
  }
}

