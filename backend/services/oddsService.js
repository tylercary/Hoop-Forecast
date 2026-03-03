import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

/**
 * Bookmaker priority list - used to select best line
 * Priority 0 = highest priority (DraftKings)
 * Updated to include all major US sportsbooks in order of reputation/market share
 */
const BOOKMAKER_PRIORITY = {
  'draftkings': 0,
  'fanduel': 1,
  'betmgm': 2,
  'caesars': 3,
  'betrivers': 4,
  'fanatics': 5,
  'espnbet': 6,
  'hardrock': 7,
  'pointsbet': 8,
  'wynnbet': 9,
  'unibet': 10,
  'barstool': 11,
  'prizepicks': 12,
  'underdog': 13,
  'bovada': 14,
  'foxbet': 15,
  'sugarhouse': 16
};

/**
 * Market validation ranges - strict validation for each prop type
 */
const MARKET_RANGES = {
  'points': { min: 5, max: 60 },
  'rebounds': { min: 2, max: 20 },
  'assists': { min: 1, max: 20 },
  'threes': { min: 0, max: 12 },
  'pra': { min: 5, max: 70 },      // Points + Rebounds + Assists
  'pr': { min: 5, max: 70 },       // Points + Rebounds
  'pa': { min: 5, max: 70 },       // Points + Assists
  'ra': { min: 5, max: 40 }        // Rebounds + Assists
};

/**
 * Market type mapping - maps The Odds API market keys to our internal prop names
 */
const MARKET_TYPE_MAP = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes',
  'player_points_rebounds_assists': 'pra',
  'player_points_rebounds': 'pr',
  'player_points_assists': 'pa',
  'player_rebounds_assists': 'ra'
};

/**
 * Reverse mapping - from our prop names to The Odds API market keys
 */
const PROP_TO_MARKET = {
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'threes': 'player_threes',
  'pra': 'player_points_rebounds_assists',
  'pr': 'player_points_rebounds',
  'pa': 'player_points_assists',
  'ra': 'player_rebounds_assists'
};

/**
 * Normalize player name for matching
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get bookmaker priority (lower = higher priority)
 */
function getBookmakerPriority(bookmakerKey) {
  if (!bookmakerKey) return 999;
  const key = bookmakerKey.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  for (const [bookmaker, priority] of Object.entries(BOOKMAKER_PRIORITY)) {
    if (key.includes(bookmaker) || bookmaker.includes(key)) {
      return priority;
    }
  }
  return 999;
}

/**
 * Validate line is within expected range for a prop type
 */
function isValidLineForProp(propType, line) {
  if (line == null || isNaN(line) || line <= 0) return false;
  const range = MARKET_RANGES[propType];
  if (!range) return false;
  return line >= range.min && line <= range.max;
}

/**
 * Normalize market classification - corrects mislabeled markets
 * This is the bulletproof market-detection layer
 */
function normalizeMarketClassification(marketKey, line) {
  if (!marketKey || line == null) return null;
  
  const key = marketKey.toLowerCase();
  
  // Rule 1: RA market with line > 40 is actually PRA
  if (key.includes('rebounds') && key.includes('assists') && !key.includes('points')) {
    if (line > 40 && line <= 70) {
      return 'pra';
    }
    if (line >= 5 && line <= 40) {
      return 'ra';
    }
  }
  
  // Rule 2: PRA market with line < 40 might be RA
  if (key.includes('points') && key.includes('rebounds') && key.includes('assists')) {
    if (line >= 5 && line < 40) {
      // Could be mislabeled RA, but if it's in PRA range, keep as PRA
      if (line >= 20) {
        return 'pra'; // Keep as PRA if in valid range
      }
      return 'ra'; // Otherwise it's RA
    }
    if (line >= 40 && line <= 70) {
      return 'pra';
    }
  }
  
  // Rule 3: PR market detection
  if (key.includes('points') && key.includes('rebounds') && !key.includes('assists')) {
    if (line >= 5 && line <= 70) {
      return 'pr';
    }
  }
  
  // Rule 4: PA market detection
  if (key.includes('points') && key.includes('assists') && !key.includes('rebounds')) {
    if (line >= 5 && line <= 70) {
      return 'pa';
    }
  }
  
  // Rule 5: Single prop detection
  if (key === 'player_points' || (key.includes('points') && !key.includes('rebounds') && !key.includes('assists'))) {
    if (line >= 5 && line <= 60) {
      return 'points';
    }
  }
  
  if (key === 'player_rebounds' || (key.includes('rebounds') && !key.includes('points') && !key.includes('assists'))) {
    if (line >= 2 && line <= 20) {
      return 'rebounds';
    }
  }
  
  if (key === 'player_assists' || (key.includes('assists') && !key.includes('points') && !key.includes('rebounds'))) {
    if (line >= 1 && line <= 20) {
      return 'assists';
    }
  }
  
  if (key === 'player_threes' || key.includes('threes') || key.includes('three')) {
    if (line >= 0 && line <= 12) {
      return 'threes';
    }
  }
  
  return null;
}

/**
 * Auto-detect combined props by summing child props
 * If PRA/PR/PA/RA is missing, try to construct it from individual props
 */
function autoDetectCombinedProps(collectedProps) {
  const result = { ...collectedProps };
  
  // Auto-detect PRA if missing: points + rebounds + assists
  if (!result.pra || result.pra.status === 'unavailable') {
    if (result.points && result.points.line && result.rebounds && result.rebounds.line && result.assists && result.assists.line) {
      const praLine = result.points.line + result.rebounds.line + result.assists.line;
      if (isValidLineForProp('pra', praLine)) {
        result.pra = {
          line: praLine,
          over_odds: -110,
          under_odds: -110,
          bookmaker: 'Calculated',
          bookmaker_key: 'calculated',
          source: 'calculated',
          market: 'player_points_rebounds_assists',
          all_bookmakers: []
        };
      }
    }
  }
  
  // Auto-detect PR if missing: points + rebounds
  if (!result.pr || result.pr.status === 'unavailable') {
    if (result.points && result.points.line && result.rebounds && result.rebounds.line) {
      const prLine = result.points.line + result.rebounds.line;
      if (isValidLineForProp('pr', prLine)) {
        result.pr = {
          line: prLine,
          over_odds: -110,
          under_odds: -110,
          bookmaker: 'Calculated',
          bookmaker_key: 'calculated',
          source: 'calculated',
          market: 'player_points_rebounds',
          all_bookmakers: []
        };
      }
    }
  }
  
  // Auto-detect PA if missing: points + assists
  if (!result.pa || result.pa.status === 'unavailable') {
    if (result.points && result.points.line && result.assists && result.assists.line) {
      const paLine = result.points.line + result.assists.line;
      if (isValidLineForProp('pa', paLine)) {
        result.pa = {
          line: paLine,
          over_odds: -110,
          under_odds: -110,
          bookmaker: 'Calculated',
          bookmaker_key: 'calculated',
          source: 'calculated',
          market: 'player_points_assists',
          all_bookmakers: []
        };
      }
    }
  }
  
  // Auto-detect RA if missing: rebounds + assists
  if (!result.ra || result.ra.status === 'unavailable') {
    if (result.rebounds && result.rebounds.line && result.assists && result.assists.line) {
      const raLine = result.rebounds.line + result.assists.line;
      if (isValidLineForProp('ra', raLine)) {
        result.ra = {
          line: raLine,
          over_odds: -110,
          under_odds: -110,
          bookmaker: 'Calculated',
          bookmaker_key: 'calculated',
          source: 'calculated',
          market: 'player_rebounds_assists',
          all_bookmakers: []
        };
      }
    }
  }
  
  return result;
}

/**
 * Parse ALL markets from The Odds API response
 * This is a bulletproof parser that checks every market, not just requested ones
 */
function parseAllMarkets(data, playerName) {
  if (!data || !playerName) return {};
  
  const normalizedPlayerName = normalizeName(playerName);
  const nameParts = normalizedPlayerName.split(' ').filter(Boolean);
  
  // Collect all lines by prop type
  const collectedLines = {
    points: [],
    rebounds: [],
    assists: [],
    threes: [],
    pra: [],
    pr: [],
    pa: [],
    ra: []
  };
  
  const bookmakers = data.bookmakers || [];

  // Step 1: Parse ALL markets (not just requested ones)
  for (const bookmaker of bookmakers) {
    const bookmakerKey = bookmaker.key || '';
    const bookmakerTitle = bookmaker.title || bookmakerKey;
    const priority = getBookmakerPriority(bookmakerKey);
    const markets = bookmaker.markets || [];
    
    for (const market of markets) {
      const marketKey = market.key || '';
      const outcomes = market.outcomes || [];
      
      // Check each outcome for player match
      for (const outcome of outcomes) {
        const outcomeDesc = normalizeName(outcome.description || '');
        const outcomePlayerName = normalizeName(outcome.player_name || '');
        
        // Match player name
        let playerMatches = false;
        if (nameParts.length >= 2) {
          const firstName = nameParts[0];
          const lastName = nameParts[nameParts.length - 1];
          const hasFirstName = outcomeDesc.includes(firstName) || outcomePlayerName.includes(firstName);
          const hasLastName = outcomeDesc.includes(lastName) || outcomePlayerName.includes(lastName);
          const fullMatch = outcomeDesc === normalizedPlayerName || outcomePlayerName === normalizedPlayerName;
          playerMatches = fullMatch || (hasFirstName && hasLastName);
        } else {
          playerMatches = outcomeDesc.includes(nameParts[0]) || outcomePlayerName.includes(nameParts[0]);
        }
        
        if (!playerMatches) continue;
        
        const line = parseFloat(outcome.point);
        if (isNaN(line) || line <= 0) continue;
        
        // Classify market using bulletproof detection
        let propType = normalizeMarketClassification(marketKey, line);
        
        // If classification failed, try to infer from market key
        if (!propType) {
          const marketKeyLower = marketKey.toLowerCase();
          if (marketKeyLower === 'player_points' || (marketKeyLower.includes('points') && !marketKeyLower.includes('rebounds') && !marketKeyLower.includes('assists'))) {
            propType = 'points';
          } else if (marketKeyLower === 'player_rebounds' || (marketKeyLower.includes('rebounds') && !marketKeyLower.includes('points') && !marketKeyLower.includes('assists'))) {
            propType = 'rebounds';
          } else if (marketKeyLower === 'player_assists' || (marketKeyLower.includes('assists') && !marketKeyLower.includes('points') && !marketKeyLower.includes('rebounds'))) {
            propType = 'assists';
          } else if (marketKeyLower === 'player_threes' || marketKeyLower.includes('threes') || marketKeyLower.includes('three')) {
            propType = 'threes';
          } else if (marketKeyLower.includes('points') && marketKeyLower.includes('rebounds') && marketKeyLower.includes('assists')) {
            propType = 'pra';
          } else if (marketKeyLower.includes('points') && marketKeyLower.includes('rebounds') && !marketKeyLower.includes('assists')) {
            propType = 'pr';
          } else if (marketKeyLower.includes('points') && marketKeyLower.includes('assists') && !marketKeyLower.includes('rebounds')) {
            propType = 'pa';
          } else if (marketKeyLower.includes('rebounds') && marketKeyLower.includes('assists') && !marketKeyLower.includes('points')) {
            propType = 'ra';
          }
        }
        
        // Validate line for prop type - REJECT if invalid
        if (propType && isValidLineForProp(propType, line)) {
          // Get over/under odds
              let overOdds = -110;
              let underOdds = -110;
              
              const outcomeName = (outcome.name || '').toLowerCase();
              if (outcomeName === 'over') {
                overOdds = outcome.price || -110;
            // Find corresponding under
                for (const otherOutcome of outcomes) {
                  const otherName = (otherOutcome.name || '').toLowerCase();
                  const otherPoint = parseFloat(otherOutcome.point);
              const otherDesc = normalizeName(otherOutcome.description || '');
              if (otherName === 'under' && Math.abs(otherPoint - line) < 0.1 && 
                  (otherDesc === outcomeDesc || otherDesc.includes(nameParts[0]))) {
                    underOdds = otherOutcome.price || -110;
                    break;
                  }
                }
              } else if (outcomeName === 'under') {
                underOdds = outcome.price || -110;
            // Find corresponding over
                for (const otherOutcome of outcomes) {
                  const otherName = (otherOutcome.name || '').toLowerCase();
                  const otherPoint = parseFloat(otherOutcome.point);
              const otherDesc = normalizeName(otherOutcome.description || '');
              if (otherName === 'over' && Math.abs(otherPoint - line) < 0.1 &&
                  (otherDesc === outcomeDesc || otherDesc.includes(nameParts[0]))) {
                    overOdds = otherOutcome.price || -110;
                    break;
                  }
                }
              }

          collectedLines[propType].push({
            line,
                over_odds: overOdds,
                under_odds: underOdds,
                bookmaker: bookmakerTitle,
            bookmaker_key: bookmakerKey,
            priority,
                last_update: new Date().toISOString()
              });
        } else if (propType) {
          // Log rejected lines for debugging
        }
      }
    }
  }
  
  // Step 2: Select best line for each prop (by priority)
  const finalProps = {};
  
  for (const [propType, lines] of Object.entries(collectedLines)) {
    if (lines.length === 0) continue;
    
    // Sort by priority (lower = better), then by line value for consistency
    lines.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.line - b.line;
    });
    
    const bestLine = lines[0];
    
    finalProps[propType] = {
      player: playerName,
      line: bestLine.line,
      over_odds: bestLine.over_odds,
      under_odds: bestLine.under_odds,
      bookmaker: bestLine.bookmaker,
      bookmaker_key: bestLine.bookmaker_key,
      last_update: bestLine.last_update,
      source: 'theoddsapi',
      market: PROP_TO_MARKET[propType] || propType,
      all_bookmakers: lines.map(l => ({
        bookmaker: l.bookmaker,
        bookmaker_key: l.bookmaker_key,
        line: l.line,
        over_odds: l.over_odds,
        under_odds: l.under_odds,
        last_update: l.last_update
      }))
    };
  }
  
  // Step 3: Auto-detect combined props if missing
  const propsWithCombined = autoDetectCombinedProps(finalProps);
  
  return propsWithCombined;
}

/**
 * Create empty props object with status: "unavailable" for missing props
 */
function createEmptyPropsObject(playerName) {
  return {
    points: { status: 'unavailable' },
    rebounds: { status: 'unavailable' },
    assists: { status: 'unavailable' },
    threes: { status: 'unavailable' },
    pra: { status: 'unavailable' },
    pr: { status: 'unavailable' },
    pa: { status: 'unavailable' },
    ra: { status: 'unavailable' }
  };
}

/**
 * Ensure all 8 props are present in the result
 * Missing props get status: "unavailable"
 */
function ensureAllPropsPresent(props, playerName) {
  const requiredProps = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
  const result = { ...props };
  
  for (const propType of requiredProps) {
    if (!result[propType] || result[propType].status === 'unavailable') {
      // Only set unavailable if it's truly missing (not if it has a line)
      if (!result[propType] || !result[propType].line) {
        result[propType] = { status: 'unavailable' };
      }
    }
  }
  
  return result;
}

/**
 * Main function: Get player odds for ALL prop types
 * ALWAYS returns an object with all 8 props (may have status: "unavailable" if missing)
 */
export async function getPlayerOdds(playerId, playerName, gameInfo = {}) {
  if (!playerName) {
    return createEmptyPropsObject(playerName || 'Unknown');
  }

  if (!THE_ODDS_API_KEY) {
    return createEmptyPropsObject(playerName);
  }

  try {
    // Step 1: Get all NBA events
    const eventsUrl = `${THE_ODDS_API_BASE}/sports/basketball_nba/events`;
    const eventsResponse = await axios.get(eventsUrl, {
      params: { apiKey: THE_ODDS_API_KEY },
      timeout: 10000
    });

    if (!eventsResponse.data || eventsResponse.data.length === 0) {
      return createEmptyPropsObject(playerName);
    }

    // Step 2: Find matching event (if team info provided)
    let targetEvent = null;
    if (gameInfo.teamAbbrev && gameInfo.opponentAbbrev) {
      for (const event of eventsResponse.data) {
        const homeTeam = (event.home_team || '').toLowerCase();
        const awayTeam = (event.away_team || '').toLowerCase();
        const playerTeam = (gameInfo.teamAbbrev || '').toLowerCase();
        const opponent = (gameInfo.opponentAbbrev || '').toLowerCase();
        
        if ((homeTeam.includes(playerTeam) && awayTeam.includes(opponent)) ||
            (awayTeam.includes(playerTeam) && homeTeam.includes(opponent))) {
          targetEvent = event;
          break;
        }
      }
    }

    // Step 3: Try to find player in events
    // If we have a target event, only check that one
    // Otherwise, check ALL events (not just first 5) to ensure we find the player
    const eventsToCheck = targetEvent ? [targetEvent] : eventsResponse.data;
    const allMarkets = [
      'player_points',
      'player_rebounds',
      'player_assists',
      'player_threes',
      'player_points_rebounds_assists',
      'player_points_rebounds',
      'player_points_assists',
      'player_rebounds_assists'
    ].join(',');

    for (const event of eventsToCheck) {
      try {
        const oddsUrl = `${THE_ODDS_API_BASE}/sports/basketball_nba/events/${event.id}/odds`;
        const oddsResponse = await axios.get(oddsUrl, {
          params: {
            apiKey: THE_ODDS_API_KEY,
            regions: 'us',
            markets: allMarkets,
            oddsFormat: 'american'
          },
          timeout: 15000
        });

        if (!oddsResponse.data || !oddsResponse.data.bookmakers) continue;

        // Parse ALL markets from this event (bulletproof parser)
        const props = parseAllMarkets(oddsResponse.data, playerName);
        
        if (Object.keys(props).length > 0) {
          // Add game/event metadata to the result
          const result = ensureAllPropsPresent(props, playerName);
          result._gameInfo = {
            home_team: event.home_team,
            away_team: event.away_team,
            event_id: event.id,
            commence_time: event.commence_time
          };
          
          return result;
        }
      } catch (err) {
        const status = err.response?.status;
        const errorCode = err.response?.data?.error_code;
        // Bail immediately on quota/auth errors — no point retrying other events
        if (status === 401 || status === 403 || errorCode === 'OUT_OF_USAGE_CREDITS') {
          console.error(`Odds API quota/auth error (${status}).`);
          return createEmptyPropsObject(playerName);
        }
        continue;
      }
    }

    return createEmptyPropsObject(playerName);
  } catch (error) {
    console.error(`Error fetching odds: ${error.message}`);
    return createEmptyPropsObject(playerName);
  }
}
