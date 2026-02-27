/**
 * Injury Service - Uses RapidAPI ONLY
 * Returns structured injuries: active, out, questionable, probable
 * NO ESPN references
 */

import axios from 'axios';
import NodeCache from 'node-cache';
import { imageExists, getImageUrl } from './imageStorageService.js';

// Cache injuries for 5 minutes (injuries can change frequently)
const injuryCache = new NodeCache({ stdTTL: 300 });

/**
 * Fetch injuries from RapidAPI NBA Injuries Reports API
 * @param {string} date - Date in YYYY-MM-DD format (defaults to today)
 * @returns {Promise<Array>} Array of injury reports
 */
async function fetchInjuriesFromRapidAPI(date = null) {
  try {
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    if (!rapidApiKey) {
      console.log('⚠️ No RapidAPI key configured - injuries unavailable');
      return [];
    }
    
    // If no date provided, try today, yesterday, and day before yesterday
    // NBA injury reports are typically published the day before games
    const datesToTry = [];
    if (date) {
      datesToTry.push(date);
    } else {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const dayBefore = new Date(today);
      dayBefore.setDate(dayBefore.getDate() - 2);
      
      // Try today, yesterday, and day before (most recent first)
      datesToTry.push(
        today.toISOString().split('T')[0],
        yesterday.toISOString().split('T')[0],
        dayBefore.toISOString().split('T')[0]
      );
    }
    
    // Try dates in parallel for faster response (limit to 2 most recent dates)
    const datesToTryLimited = datesToTry.slice(0, 2); // Only try today and yesterday
    const datePromises = datesToTryLimited.map(async (tryDate) => {
      const injuryUrl = `https://nba-injuries-reports.p.rapidapi.com/injuries/nba/${tryDate}`;

      try {
        const response = await axios.get(injuryUrl, {
          headers: {
            'X-RapidAPI-Key': rapidApiKey,
            'X-RapidAPI-Host': 'nba-injuries-reports.p.rapidapi.com',
            'Accept': 'application/json'
          },
          timeout: 8000 // Reduced timeout for faster failure
        });

        // Check if response.data is directly an array
        if (Array.isArray(response.data)) {
          if (response.data.length > 0) {
            return { date: tryDate, data: response.data };
          }
          // Empty array - try next date
          return null;
        }

        // Check for nested data structures
        if (response.data && typeof response.data === 'object') {
          if (Array.isArray(response.data.data) && response.data.data.length > 0) {
            return { date: tryDate, data: response.data.data };
          }
          if (Array.isArray(response.data.injuries) && response.data.injuries.length > 0) {
            return { date: tryDate, data: response.data.injuries };
          }
          if (Array.isArray(response.data.items) && response.data.items.length > 0) {
            return { date: tryDate, data: response.data.items };
          }
        }

        return null;
      } catch (dateError) {
        // Silently fail - try next date
        return null;
      }
    });
    
    // Wait for first successful result
    const results = await Promise.allSettled(datePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && result.value.data) {
        console.log(`✅ [INJURY API] Fetched ${result.value.data.length} injuries from RapidAPI (date: ${result.value.date})`);
        return result.value.data;
      }
    }

    // If all failed, return empty array
    console.log('⚠️ [INJURY API] No injury data returned from RapidAPI for recent dates');
    return [];
  } catch (error) {
    console.error(`❌ [INJURY API] Error fetching from RapidAPI:`, error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Status Text: ${error.response.statusText}`);
      console.error(`   Response Data:`, JSON.stringify(error.response.data).substring(0, 200));
    } else if (error.request) {
      console.error(`   Request made but no response received`);
      console.error(`   Request URL: ${error.config?.url}`);
    } else {
      console.error(`   Error setting up request:`, error.message);
    }
    return [];
  }
}

/**
 * Map team full name to abbreviation
 */
function getTeamAbbrevFromFullName(teamName) {
  if (!teamName) {
    return null;
  }
  
  const teamMap = {
    'Atlanta Hawks': 'ATL',
    'Boston Celtics': 'BOS',
    'Brooklyn Nets': 'BKN',
    'Charlotte Hornets': 'CHA',
    'Chicago Bulls': 'CHI',
    'Cleveland Cavaliers': 'CLE',
    'Dallas Mavericks': 'DAL',
    'Denver Nuggets': 'DEN',
    'Detroit Pistons': 'DET',
    'Golden State Warriors': 'GSW',
    'Houston Rockets': 'HOU',
    'Indiana Pacers': 'IND',
    'LA Clippers': 'LAC',
    'Los Angeles Clippers': 'LAC',
    'Los Angeles Lakers': 'LAL',
    'Memphis Grizzlies': 'MEM',
    'Miami Heat': 'MIA',
    'Milwaukee Bucks': 'MIL',
    'Minnesota Timberwolves': 'MIN',
    'New Orleans Pelicans': 'NOP',
    'New York Knicks': 'NYK',
    'Oklahoma City Thunder': 'OKC',
    'Orlando Magic': 'ORL',
    'Philadelphia 76ers': 'PHI',
    'Phoenix Suns': 'PHX',
    'Portland Trail Blazers': 'POR',
    'Sacramento Kings': 'SAC',
    'San Antonio Spurs': 'SAS',
    'Toronto Raptors': 'TOR',
    'Utah Jazz': 'UTA',
    'Washington Wizards': 'WAS'
  };
  
  // Try exact match first
  if (teamMap[teamName]) {
    return teamMap[teamName];
  }
  
  // Try case-insensitive match
  const teamNameLower = teamName.toLowerCase();
  for (const [fullName, abbrev] of Object.entries(teamMap)) {
    if (fullName.toLowerCase() === teamNameLower) {
      return abbrev;
    }
  }
  
  // If no match found, log for debugging
  console.log(`⚠️  [TEAM MAP] No abbreviation found for team name: "${teamName}"`);
  return null;
}

/**
 * Extract injury type from reason string (e.g., "Left Ankle; Soreness" -> "Ankle")
 */
function extractInjuryTypeFromReason(reason) {
  if (!reason) return null;
  
  const parts = reason.split(';');
  let injuryPart = parts[0].trim();
  
  // Remove "Injury/Illness - " prefix if present
  injuryPart = injuryPart.replace(/^injury\/illness\s*-\s*/i, '').trim();
  
  // Remove directional words (Left, Right, Bilateral)
  const cleaned = injuryPart.replace(/^(left|right|bilateral)\s+/i, '').trim();
  
  // If cleaned is empty, try to extract from the second part
  if (!cleaned || cleaned.length < 2) {
    if (parts.length > 1) {
      return parts[1].trim().charAt(0).toUpperCase() + parts[1].trim().slice(1).toLowerCase();
    }
    return null;
  }
  
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/**
 * Normalize status to structured format
 * Returns: 'active', 'out', 'questionable', 'probable'
 */
function normalizeStatus(status) {
  if (!status) return 'active';
  
  const statusLower = status.toLowerCase();
  
  if (statusLower.includes('out') || statusLower.includes('injured reserve')) {
    return 'out';
  } else if (statusLower.includes('questionable') || statusLower.includes('doubtful')) {
    return 'questionable';
  } else if (statusLower.includes('probable') || statusLower.includes('likely')) {
    return 'probable';
  }
  
  return 'active';
}

// Cache for player image lookups to avoid expensive file system checks
const playerImageCache = new Map();

/**
 * Format player name to match local image filename format
 * e.g., "LeBron James" -> "lebron_james"
 */
function formatPlayerNameForImage(playerName) {
  if (!playerName) return null;
  return playerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Check if player image exists locally and return URL
 * @param {string} playerName - Player's name
 * @returns {string|null} Image URL or null if not found
 */
function getPlayerImageUrl(playerName) {
  if (!playerName) return null;

  // Check cache first
  if (playerImageCache.has(playerName)) {
    return playerImageCache.get(playerName);
  }

  // Format name for filename
  const formattedName = formatPlayerNameForImage(playerName);
  if (!formattedName) {
    playerImageCache.set(playerName, null);
    return null;
  }

  // Construct image URL (frontend will handle 404s gracefully)
  const imageUrl = `/images/players/${formattedName}.png`;

  // Cache the result
  playerImageCache.set(playerName, imageUrl);
  return imageUrl;
}

/**
 * Format injury from RapidAPI to our standard format
 * Checks for local player images
 */
function formatInjury(injury) {
  // Only set headshot if the local image file actually exists
  const headshot = imageExists(injury.player) ? getImageUrl(injury.player) : null;

  return {
    playerName: injury.player,
    position: 'Unknown', // Position not available from RapidAPI
    status: injury.status, // Original status for display
    structuredStatus: normalizeStatus(injury.status), // Normalized: active, out, questionable, probable
    injury: extractInjuryTypeFromReason(injury.reason) || 'Not specified',
    comment: injury.reason || '',
    date: injury.date,
    playerId: null, // Not fetched for performance
    headshot: headshot,
    impactScore: 50 // Default impact score
  };
}

/**
 * Get team injuries from RapidAPI ONLY
 * @param {string} teamAbbrev - Team abbreviation (e.g., 'LAL', 'GSW')
 * @returns {Promise<Array>} Array of injury objects with structured status
 */
export async function getTeamInjuries(teamAbbrev) {
  try {
    if (!teamAbbrev || teamAbbrev === 'N/A') {
      return [];
    }

    // Check cache first
    const cacheKey = `injuries_${teamAbbrev.toUpperCase()}`;
    const cached = injuryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from RapidAPI ONLY
    const rapidApiInjuries = await fetchInjuriesFromRapidAPI();
    if (rapidApiInjuries && rapidApiInjuries.length > 0) {
      // Filter injuries for this team and exclude G-League/Two-Way roster moves
      const teamInjuries = rapidApiInjuries.filter(injury => {
        const injuryTeamAbbrev = getTeamAbbrevFromFullName(injury.team);

        // Exclude G-League and Two-Way players (not real injuries)
        const isGLeagueOrTwoWay = injury.reason && (
          injury.reason.toLowerCase().includes('g league') ||
          injury.reason.toLowerCase().includes('two-way') ||
          injury.reason.toLowerCase().includes('two way')
        );

        return injuryTeamAbbrev === teamAbbrev && !isGLeagueOrTwoWay;
      });

      if (teamInjuries.length > 0) {
        // Convert to our format with structured status (synchronous - no API calls)
        const formattedInjuries = teamInjuries.map(formatInjury);

        console.log(`✅ [INJURIES] Found ${formattedInjuries.length} injuries for ${teamAbbrev}`);
        injuryCache.set(cacheKey, formattedInjuries);
        return formattedInjuries;
      }
    }

    // No injuries found from RapidAPI
    console.log(`⚠️ [INJURIES] No injuries found for ${teamAbbrev}`);
    injuryCache.set(cacheKey, []);
    return [];
  } catch (error) {
    console.error(`❌ Error fetching injuries for ${teamAbbrev}:`, error.message);
    // Return empty array on error (don't break predictions)
    return [];
  }
}

/**
 * Get injuries for both teams in a matchup using RapidAPI ONLY
 * @param {string} playerTeamAbbrev - Player's team abbreviation
 * @param {string} opponentAbbrev - Opponent team abbreviation
 * @param {string|null} eventId - Event ID (ignored - we only use RapidAPI)
 * @returns {Promise<Object>} Object with playerTeamInjuries and opponentInjuries
 */
export async function getMatchupInjuries(playerTeamAbbrev, opponentAbbrev, eventId = null) {
  try {
    if (!playerTeamAbbrev || playerTeamAbbrev === 'N/A') {
      return {
        playerTeamInjuries: [],
        opponentInjuries: [],
        hasPlayerTeamInjuries: false,
        hasOpponentInjuries: false
      };
    }
    
    if (!opponentAbbrev || opponentAbbrev === 'N/A') {
      return {
        playerTeamInjuries: [],
        opponentInjuries: [],
        hasPlayerTeamInjuries: false,
        hasOpponentInjuries: false
      };
    }
    
    // Fetch from RapidAPI ONLY
    const rapidApiInjuries = await fetchInjuriesFromRapidAPI();
    
    if (rapidApiInjuries && rapidApiInjuries.length > 0) {
      // Filter injuries for each team, excluding G-League/Two-Way roster moves
      const playerTeamInjuriesRaw = rapidApiInjuries.filter(injury => {
        if (!injury.team) {
          return false;
        }
        const injuryTeamAbbrev = getTeamAbbrevFromFullName(injury.team);

        // Exclude G-League and Two-Way players (not real injuries)
        const isGLeagueOrTwoWay = injury.reason && (
          injury.reason.toLowerCase().includes('g league') ||
          injury.reason.toLowerCase().includes('two-way') ||
          injury.reason.toLowerCase().includes('two way')
        );

        return injuryTeamAbbrev === playerTeamAbbrev.toUpperCase() && !isGLeagueOrTwoWay;
      });

      const opponentInjuriesRaw = rapidApiInjuries.filter(injury => {
        if (!injury.team) {
          return false;
        }
        const injuryTeamAbbrev = getTeamAbbrevFromFullName(injury.team);

        // Exclude G-League and Two-Way players (not real injuries)
        const isGLeagueOrTwoWay = injury.reason && (
          injury.reason.toLowerCase().includes('g league') ||
          injury.reason.toLowerCase().includes('two-way') ||
          injury.reason.toLowerCase().includes('two way')
        );

        return injuryTeamAbbrev === opponentAbbrev.toUpperCase() && !isGLeagueOrTwoWay;
      });
      
      // Format injuries with structured status (synchronous - no expensive API calls)
      const playerTeamInjuries = playerTeamInjuriesRaw.map(formatInjury);
      const opponentInjuries = opponentInjuriesRaw.map(formatInjury);

      console.log(`✅ [MATCHUP INJURIES] ${playerTeamAbbrev}: ${playerTeamInjuries.length} injuries, ${opponentAbbrev}: ${opponentInjuries.length} injuries`);

      return {
        playerTeamInjuries,
        opponentInjuries,
        hasPlayerTeamInjuries: playerTeamInjuries.length > 0,
        hasOpponentInjuries: opponentInjuries.length > 0
      };
    }

    // No injuries found from RapidAPI - return empty arrays
    console.log(`⚠️ [MATCHUP INJURIES] No injury data available from RapidAPI`);
    return {
      playerTeamInjuries: [],
      opponentInjuries: [],
      hasPlayerTeamInjuries: false,
      hasOpponentInjuries: false
    };
  } catch (error) {
    // Silently fail - don't break predictions
    return {
      playerTeamInjuries: [],
      opponentInjuries: [],
      hasPlayerTeamInjuries: false,
      hasOpponentInjuries: false
    };
  }
}

/**
 * Calculate injury adjustment factor for a player's prediction
 * If star players on the same team are injured, this player may score more
 * @param {string} playerName - Name of the player we're predicting
 * @param {string} playerTeamAbbrev - Player's team abbreviation
 * @param {Array} injuries - Array of injury objects for the team
 * @returns {number} Adjustment factor (1.0 = no change, >1.0 = increase, <1.0 = decrease)
 */
export function calculateInjuryAdjustment(playerName, playerTeamAbbrev, injuries) {
  if (!injuries || injuries.length === 0) {
    return 1.0; // No adjustment
  }

  // Check if the player themselves is injured
  const playerInjured = injuries.some(injury => 
    injury.playerName.toLowerCase().includes(playerName.toLowerCase()) ||
    playerName.toLowerCase().includes(injury.playerName.toLowerCase())
  );

  if (playerInjured) {
    // If player is injured, significantly reduce prediction
    return 0.3; // 70% reduction
  }

  // Filter to only "better players" - those with impact score >= 80 (starters and key players)
  // Only injuries to better players should affect predictions
  const betterPlayerInjuries = injuries.filter(injury => {
    const isOtherPlayer = !injury.playerName.toLowerCase().includes(playerName.toLowerCase()) &&
                          !playerName.toLowerCase().includes(injury.playerName.toLowerCase());
    const isBetterPlayer = injury.impactScore >= 80; // Only count starters/key players
    return isOtherPlayer && isBetterPlayer;
  });

  if (betterPlayerInjuries.length === 0) {
    return 1.0; // No better players injured
  }

  // Sum up impact scores of injured better players only
  const totalImpact = betterPlayerInjuries.reduce((sum, injury) => sum + injury.impactScore, 0);
  
  // Higher impact = more opportunity for this player
  // More aggressive scaling for key player injuries: 80-120 = 1.08x, 120-180 = 1.15x, 180+ = 1.25x
  let adjustment = 1.0;
  if (totalImpact >= 180) {
    adjustment = 1.25; // 25% increase for multiple star injuries (e.g., 2-3 starters out)
  } else if (totalImpact >= 120) {
    adjustment = 1.15; // 15% increase for significant injuries
  } else if (totalImpact >= 80) {
    adjustment = 1.08; // 8% increase for at least one key player
  }

  // If top better player (highest impact, typically a star) is injured, add extra boost
  const topInjuredPlayer = betterPlayerInjuries[0];
  if (topInjuredPlayer && topInjuredPlayer.impactScore >= 100) {
    adjustment += 0.10; // Additional 10% if star player (high impact) is out
  } else if (topInjuredPlayer && topInjuredPlayer.impactScore >= 90) {
    adjustment += 0.05; // Additional 5% if key starter is out
  }

  // Cap at 30% increase (more aggressive for key injuries)
  return Math.min(adjustment, 1.30);
}

/**
 * Format injuries for display in prediction prompt
 * @param {Array} injuries - Array of injury objects
 * @param {string} teamName - Team name for context
 * @returns {string} Formatted injury text
 */
export function formatInjuriesForPrompt(injuries, teamName) {
  if (!injuries || injuries.length === 0) {
    return '';
  }

  const injuryLines = injuries.map(injury => {
    return `- ${injury.playerName} (${injury.position}): ${injury.status} - ${injury.injury}${injury.comment ? ` (${injury.comment})` : ''}`;
  });

  return `\n\nInjury Report for ${teamName}:\n${injuryLines.join('\n')}`;
}
