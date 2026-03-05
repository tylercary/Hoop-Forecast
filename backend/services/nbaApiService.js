import axios from 'axios';
import NodeCache from 'node-cache';

/**
 * NBA.com API Service
 * Uses the official NBA.com APIs (same ones that nba_api Python package uses)
 * Documentation: https://github.com/swar/nba_api
 */

const NBA_API_BASE = 'https://stats.nba.com/stats';

// Cache for ESPN player searches (24 hours - player names don't change)
const espnSearchCache = new NodeCache({ stdTTL: 86400, useClones: false });
// Cache for ESPN gamelog data (30 minutes - stats update after games)
const espnGamelogCache = new NodeCache({ stdTTL: 1800, useClones: false });
const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com'
};

/**
 * Search for players by name using ESPN API
 * Returns array of matching players (for search functionality)
 */
export async function searchPlayersESPN(playerName) {
  try {
    // Check cache first (normalize name for cache key)
    const normalizedSearchName = playerName.toLowerCase().trim();
    const cacheKey = `espn_search:${normalizedSearchName}`;
    const cached = espnSearchCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const normalizeName = (value) => {
      if (!value) return '';
      return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^a-z0-9\s]/g, '') // Remove punctuation/special characters
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const searchName = normalizeName(playerName);
    const searchTokens = searchName.split(' ').filter(Boolean);
    const results = [];
    
    // ESPN API endpoint for NBA teams
    const teamsUrl = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
    
    // Get all NBA teams
    const teamsResponse = await axios.get(teamsUrl, {
      params: {
        region: 'us',
        lang: 'en',
        contentorigin: 'espn',
        limit: 50
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    if (!teamsResponse.data || !teamsResponse.data.sports || !teamsResponse.data.sports[0]) {
      throw new Error('Invalid response from ESPN teams API');
    }
    
    const leagues = teamsResponse.data.sports[0].leagues || [];
    const teams = leagues[0]?.teams || [];
    
    // Get rosters for each team in parallel (limit to avoid rate limits)
    const teamPromises = teams.slice(0, 30).map(async (team) => {
      try {
        const teamId = team.team?.id;
        if (!teamId) return [];
        
        const rosterUrl = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`;
        
        const rosterResponse = await axios.get(rosterUrl, {
          params: {
            region: 'us',
            lang: 'en',
            contentorigin: 'espn'
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          timeout: 10000
        });
        
        if (!rosterResponse.data) {
          return [];
        }
        
        const athletesGroups = Array.isArray(rosterResponse.data.athletes)
          ? rosterResponse.data.athletes
          : [];
        const athletes = athletesGroups.flatMap(group => {
          if (!group) return [];
          if (Array.isArray(group.items)) {
            return group.items;
          }
          return group; // in case API already returns flat array
        });
        
        const teamAbbrev = team.team?.abbreviation || team.team?.shortDisplayName || 'N/A';
        const teamName = team.team?.displayName || team.team?.name || 'N/A';
        
        // Filter athletes matching search name
        const matchingPlayers = athletes
          .filter(athlete => {
            const base = athlete.athlete || athlete;
            if (!base) return false;
            
            const fullNameRaw = `${base.firstName || ''} ${base.lastName || ''}`.trim();
            const displayNameRaw = base.displayName || fullNameRaw;
            const shortNameRaw = base.shortName || displayNameRaw;
            
            const fullName = normalizeName(fullNameRaw);
            const displayName = normalizeName(displayNameRaw);
            const shortName = normalizeName(shortNameRaw);
            
            if (!fullName && !displayName && !shortName) {
              return false;
            }
            
            if (fullName.includes(searchName) || displayName.includes(searchName) || shortName.includes(searchName)) {
              return true;
            }
            
            if (searchTokens.length > 1) {
              return searchTokens.every(token => 
                fullName.includes(token) || displayName.includes(token) || shortName.includes(token)
              );
            }
            
            return fullName.startsWith(searchName) || displayName.startsWith(searchName) || shortName.startsWith(searchName);
          })
          .map(athlete => {
            const base = athlete.athlete || athlete;
            const positionInfo = athlete.position || base.position || {};
            const headshot = base.headshot?.href || base.headshot || null;
            const jersey = base.jersey || athlete.jersey || null;
            const playerId = base.id || athlete.id;
            const firstName = base.firstName || '';
            const lastName = base.lastName || '';
            const fullName = `${firstName} ${lastName}`.trim();
            
            return {
              id: playerId, // ESPN ID
              first_name: firstName,
              last_name: lastName,
              full_name: fullName,
              display_name: base.displayName || fullName,
              position: positionInfo.abbreviation || positionInfo.name || 'N/A',
              team: {
                abbreviation: teamAbbrev,
                name: teamName
              },
              team_name: teamName,
              jersey: jersey,
              headshot: headshot,
              espn_id: playerId
            };
          });
        
        return matchingPlayers;
      } catch (error) {
        // Silently skip teams that fail (rate limits, etc.)
        return [];
      }
    });
    
    // Wait for all roster requests (with some delay to avoid rate limits)
    const rosterResults = await Promise.allSettled(teamPromises);
    
    // Flatten results
    for (const result of rosterResults) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        results.push(...result.value);
      }
    }
    
    // Remove duplicates (same player ID)
    const uniqueResults = [];
    const seenIds = new Set();
    for (const player of results) {
      if (!seenIds.has(player.id)) {
        seenIds.add(player.id);
        uniqueResults.push(player);
      }
    }
    
    // Sort by relevance (exact name matches first)
    uniqueResults.sort((a, b) => {
      const aName = normalizeName(a.full_name);
      const bName = normalizeName(b.full_name);
      const aStarts = aName.startsWith(searchName);
      const bStarts = bName.startsWith(searchName);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return aName.localeCompare(bName);
    });
    
    
    return uniqueResults.slice(0, 25);
    
  } catch (error) {
    console.error('ESPN player search error:', error.message);
    return [];
  }
}

/**
 * Get player stats from ESPN gamelog API
 * Replaces NBA.com which blocks cloud server IPs
 * Returns stats in the same format as getPlayerStatsFromNBA for drop-in replacement
 */
export async function getPlayerStatsFromESPN(playerName) {
  try {
    // Check gamelog cache first
    const cacheKey = `espn_gamelog:${playerName.toLowerCase().trim()}`;
    const cached = espnGamelogCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Step 1: Find the player via ESPN search to get their ESPN ID
    const espnResults = await searchPlayersESPN(playerName);
    if (!espnResults || espnResults.length === 0) {
      throw new Error(`Player "${playerName}" not found on ESPN`);
    }
    const espnPlayer = espnResults[0];
    const espnId = espnPlayer.espn_id || espnPlayer.id;
    if (!espnId) {
      throw new Error(`No ESPN ID found for "${playerName}"`);
    }

    // Step 2: Fetch gamelog for current season
    const gamelogUrl = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnId}/gamelog`;
    const espnHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json'
    };

    const [currentResponse, previousResponse] = await Promise.allSettled([
      axios.get(gamelogUrl, { headers: espnHeaders, timeout: 15000 }),
      axios.get(gamelogUrl, {
        params: { season: getEspnPreviousSeason() },
        headers: espnHeaders,
        timeout: 15000
      })
    ]);

    const currentData = currentResponse.status === 'fulfilled' ? currentResponse.value.data : null;
    const previousData = previousResponse.status === 'fulfilled' ? previousResponse.value.data : null;

    if (!currentData) {
      throw new Error(`Failed to fetch ESPN gamelog for ${playerName}`);
    }

    // Step 3: Parse games from ESPN response
    const currentGames = parseEspnGamelog(currentData, getCurrentSeason());
    const previousGames = previousData ? parseEspnGamelog(previousData, getPreviousSeason(getCurrentSeason())) : [];

    // Combine: current season first (most recent first), then previous season
    const allGames = [...currentGames, ...previousGames].map((game, index) => ({
      ...game,
      game_number: index + 1
    }));

    if (allGames.length === 0) {
      throw new Error(`No game data found for ${playerName}`);
    }

    // Step 4: Get team info from ESPN player data
    const teamAbbrev = mapEspnToNbaAbbrev(espnPlayer.team?.abbreviation) || espnPlayer.team?.abbreviation || 'N/A';
    const teamName = espnPlayer.team?.name || espnPlayer.team_name || 'N/A';

    const result = {
      player: {
        id: espnId,
        nba_id: espnId,
        first_name: espnPlayer.first_name || '',
        last_name: espnPlayer.last_name || '',
        position: espnPlayer.position || 'N/A',
        team: teamAbbrev,
        team_name: teamName,
        team_details: {
          abbreviation: teamAbbrev,
          name: teamName
        }
      },
      games: allGames
    };

    // Cache the result
    espnGamelogCache.set(cacheKey, result);

    return result;
  } catch (error) {
    console.error(`❌ Error fetching stats from ESPN for ${playerName}:`, error.message);
    throw error;
  }
}

/**
 * Parse ESPN gamelog response into standardized game objects
 * ESPN stats array order: MIN, FG, FG%, 3PT, 3P%, FT, FT%, REB, AST, BLK, STL, PF, TO, PTS
 */
function parseEspnGamelog(data, seasonLabel) {
  const games = [];
  const eventsMap = data.events || {};
  const seasonTypes = data.seasonTypes || [];

  // Only process Regular Season games (skip preseason, playoffs)
  for (const seasonType of seasonTypes) {
    const typeName = (seasonType.displayName || '').toLowerCase();
    if (typeName.includes('preseason')) continue;

    const categories = seasonType.categories || [];
    for (const category of categories) {
      const events = category.events || [];
      for (const event of events) {
        const eventId = event.eventId;
        const stats = event.stats || [];
        const eventMeta = eventsMap[eventId];
        if (!eventMeta || stats.length < 14) continue;

        // Parse made-attempted fields (e.g., "3-5")
        const parseMadeAttempted = (val) => {
          if (!val || typeof val !== 'string' || !val.includes('-')) return { made: 0, attempted: 0 };
          const [made, attempted] = val.split('-').map(Number);
          return { made: made || 0, attempted: attempted || 0 };
        };

        const minutes = stats[0] || '0';
        const fg = parseMadeAttempted(stats[1]);
        const threes = parseMadeAttempted(stats[3]);
        const ft = parseMadeAttempted(stats[5]);
        const rebounds = parseInt(stats[7]) || 0;
        const assists = parseInt(stats[8]) || 0;
        const blocks = parseInt(stats[9]) || 0;
        const steals = parseInt(stats[10]) || 0;
        const personalFouls = parseInt(stats[11]) || 0;
        const turnovers = parseInt(stats[12]) || 0;
        const points = parseInt(stats[13]) || 0;

        // Parse game metadata
        const gameDate = eventMeta.gameDate
          ? eventMeta.gameDate.split('T')[0]  // "2026-03-02T02:30:00.000+00:00" -> "2026-03-02"
          : '';
        const isHome = eventMeta.atVs === 'vs';
        const opponentAbbrev = mapEspnToNbaAbbrev(eventMeta.opponent?.abbreviation) || eventMeta.opponent?.abbreviation || 'N/A';
        const result = eventMeta.gameResult || ''; // "W" or "L"

        games.push({
          game_number: 0, // Will be renumbered after combining seasons
          date: gameDate,
          // Standard normalized keys
          pts: points,
          reb: rebounds,
          ast: assists,
          stl: steals,
          blk: blocks,
          tpm: threes.made,
          minutes: minutes,
          opponent: opponentAbbrev,
          // Legacy keys for backward compatibility
          points: points,
          rebounds: rebounds,
          assists: assists,
          steals: steals,
          blocks: blocks,
          threes_made: threes.made,
          threes: threes.made,
          field_goals_made: fg.made,
          fgm: fg.made,
          field_goals_attempted: fg.attempted,
          fga: fg.attempted,
          free_throws_made: ft.made,
          ftm: ft.made,
          free_throws_attempted: ft.attempted,
          fta: ft.attempted,
          three_pointers_made: threes.made,
          three_pointers_attempted: threes.attempted,
          tpa: threes.attempted,
          turnovers: turnovers,
          personal_fouls: personalFouls,
          home: isHome,
          result: result,
          season: seasonLabel
        });
      }
    }
  }

  return games;
}

/**
 * Get ESPN season parameter for previous season
 * ESPN uses the end year (e.g., 2025 for the 2024-25 season)
 */
function getEspnPreviousSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Current season: if before October, current ESPN season = year, previous = year - 1
  // If October or later, current ESPN season = year + 1, previous = year
  if (month < 10) {
    return String(year - 1);
  } else {
    return String(year);
  }
}

/**
 * Get player stats - uses ESPN (primary) with NBA.com as fallback
 * This is the main entry point used by routes
 */
export async function getPlayerStats(playerName) {
  try {
    return await getPlayerStatsFromESPN(playerName);
  } catch (espnError) {
    console.warn(`⚠️ ESPN failed for ${playerName}, trying NBA.com fallback:`, espnError.message);
    return await getPlayerStatsFromNBA(playerName);
  }
}

/**
 * Get player stats directly from NBA.com API using player name
 * Returns stats in the same format as balldontlie service
 * NOTE: NBA.com blocks cloud server IPs - use getPlayerStats() instead which uses ESPN first
 */
export async function getPlayerStatsFromNBA(playerName, retryCount = 0) {
  const maxRetries = 2;
  
  try {
    // Search for player with retry logic
    let nbaPlayer = null;
    let searchRetries = 0;
    while (searchRetries <= maxRetries && !nbaPlayer) {
      try {
        nbaPlayer = await searchPlayer(playerName);
        if (!nbaPlayer || !nbaPlayer.id) {
          throw new Error(`Player "${playerName}" not found on NBA.com`);
        }
        break;
      } catch (searchError) {
        if (searchError.message.includes('timeout') && searchRetries < maxRetries) {
          searchRetries++;
          const backoffDelay = 2000 * searchRetries; // 2s, 4s
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        throw searchError;
      }
    }
    
    if (!nbaPlayer || !nbaPlayer.id) {
      throw new Error(`Player "${playerName}" not found on NBA.com`);
    }
    
    // Get game log with retry logic
    let games = null;
    let gameLogRetries = 0;
    while (gameLogRetries <= maxRetries && !games) {
      try {
        games = await getPlayerGameLog(nbaPlayer.id, {
          includePreviousSeason: true,
          currentSeasonGames: 50, // Increased to get more H2H data
          previousSeasonGames: 50 // Increased to get more H2H data
        });
        if (!games || games.length === 0) {
          throw new Error(`No game data found for ${playerName}`);
        }
        break;
      } catch (gameLogError) {
        if (gameLogError.message.includes('timeout') && gameLogRetries < maxRetries) {
          gameLogRetries++;
          const backoffDelay = 2000 * gameLogRetries; // 2s, 4s
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        throw gameLogError;
      }
    }
    
    if (!games || games.length === 0) {
      throw new Error(`No game data found for ${playerName}`);
    }
    
    // Get player info for additional details (non-critical, don't retry)
    let playerInfo = null;
    try {
      playerInfo = await getPlayerInfo(nbaPlayer.id);
    } catch (infoError) {
    }
    
    // Parse player name
    const nameParts = nbaPlayer.name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    const teamAbbrev = typeof nbaPlayer.team === 'string'
      ? nbaPlayer.team
      : nbaPlayer.team?.abbreviation || nbaPlayer.team?.name || 'N/A';
    const teamName = typeof nbaPlayer.team === 'object'
      ? nbaPlayer.team?.name || nbaPlayer.team?.abbreviation || 'N/A'
      : nbaPlayer.team || 'N/A';

    return {
      player: {
        id: nbaPlayer.id,
        nba_id: nbaPlayer.id,
        first_name: playerInfo?.first_name || firstName,
        last_name: playerInfo?.last_name || lastName,
        position: playerInfo?.position || 'N/A',
        team: teamAbbrev,
        team_name: teamName,
        team_details: {
          abbreviation: teamAbbrev,
          name: teamName
        }
      },
      games: games
    };
  } catch (error) {
    console.error(`❌ Error fetching stats from NBA.com for ${playerName}:`, error.message);
    throw error;
  }
}

/**
 * Search for a player by name (legacy function - kept for backward compatibility)
 * Uses NBA.com API - returns single player match
 */
export async function searchPlayer(playerName) {
  try {
    // NBA.com uses a commonallplayers endpoint
    const url = `${NBA_API_BASE}/commonallplayers`;
    const normalizeName = (value) => {
      if (!value) return '';
      return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const searchTokens = normalizeName(playerName).split(' ').filter(Boolean);
    
    // Try with retry logic for rate limiting
    let response = null;
    let lastError = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.get(url, {
          params: {
            LeagueID: '00',
            Season: getCurrentSeason(),
            IsOnlyCurrentSeason: 0
          },
          headers: NBA_HEADERS,
          timeout: 10000, // Reduced to 10s to fail faster if NBA.com is slow
          validateStatus: (status) => status < 500 // Don't throw on 403/404
        });
        
        // Check if we got a valid response
        if (response.status === 403 || response.status === 429) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          } else {
            throw new Error(`NBA.com API returned ${response.status}. The API may be rate-limiting requests.`);
          }
        }
        
        break; // Success
      } catch (error) {
        lastError = error;
        if (error.response && (error.response.status === 403 || error.response.status === 429)) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
        }
        // If it's a timeout or other error on last attempt, throw
        if (attempt === 2 || (error.code === 'ECONNABORTED' && attempt >= 1)) {
          throw error;
        }
      }
    }
    
    if (!response) {
      throw lastError || new Error('Failed to search NBA.com after retries');
    }
    
    if (response.data && response.data.resultSets && response.data.resultSets[0]) {
      const players = response.data.resultSets[0].rowSet || [];
      const headers = response.data.resultSets[0].headers || [];
      
      // Find player index
      const playerNameIndex = headers.indexOf('DISPLAY_FIRST_LAST') !== -1 
        ? headers.indexOf('DISPLAY_FIRST_LAST')
        : headers.indexOf('PLAYER_NAME') !== -1
        ? headers.indexOf('PLAYER_NAME')
        : 1;
      
      const playerIdIndex = headers.indexOf('PERSON_ID') !== -1
        ? headers.indexOf('PERSON_ID')
        : 0;
      
      // Search for matching player
      const searchName = playerName.toLowerCase();
      const matches = players.filter(player => {
        const displayNameRaw = player[playerNameIndex] || '';
        const normalizedName = normalizeName(displayNameRaw);
        if (!normalizedName) return false;
        if (searchTokens.length === 0) return false;
        // Exact token match
        if (searchTokens.every(token => normalizedName.includes(token))) return true;
        // Prefix match: handles cases like "Nicolas" matching "Nic" (Odds API vs NBA.com name differences)
        const nameTokens = normalizedName.split(' ').filter(Boolean);
        return searchTokens.every(searchToken =>
          nameTokens.some(nameToken =>
            nameToken.startsWith(searchToken) || searchToken.startsWith(nameToken)
          )
        );
      });
      
      const mappedPlayers = matches.slice(0, 50).map(player => {
        const displayNameRaw = player[playerNameIndex] || '';
        const [firstName, ...rest] = displayNameRaw.split(' ');
        const lastName = rest.join(' ');
        return {
          id: player[playerIdIndex],
          name: displayNameRaw,
          nameParts: {
            firstName: firstName || '',
            lastName: lastName || '',
            fullName: displayNameRaw
          },
          team: {
            abbreviation: player[headers.indexOf('TEAM_ABBREVIATION')] || 'N/A',
            name: player[headers.indexOf('TEAM_ABBREVIATION')] || 'N/A'
          },
          position: player[headers.indexOf('POSITION')] || 'N/A',
          headshot: null,
          source: 'commonallplayers'
        };
      });
      
      if (mappedPlayers.length === 0) {
        return null;
      }
      
      // Rank best match: exact normalized name first, then startswith, otherwise first result
      const normalizedSearch = normalizeName(playerName);
      const bestMatch = mappedPlayers.find(p => normalizeName(p.nameParts.fullName) === normalizedSearch)
        || mappedPlayers.find(p => normalizeName(p.nameParts.fullName).startsWith(normalizedSearch))
        || mappedPlayers[0];
      
      return bestMatch;
    }
    
    return null;
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error('⚠️  NBA.com search timed out - API may be slow or down');
      throw new Error('NBA.com API is currently slow or unavailable. Please try again in a moment.');
    }
    console.error('❌ Error searching NBA.com:', error.message);
    throw error;
  }
}

/**
 * Get player's game log (last 10 games)
 */
export async function getPlayerGameLog(playerId, options = {}) {
  try {
    const {
      includePreviousSeason = false,
      currentSeasonGames = 10,
      previousSeasonGames = 20
    } = options;

    const currentSeason = getCurrentSeason();
    
    // Use playergamelog endpoint
    const url = `${NBA_API_BASE}/playergamelog`;
    const params = {
      LeagueID: '00',
      PlayerID: playerId,
      Season: currentSeason,
      SeasonType: 'Regular Season'
    };
    
    // Try with retry logic for rate limiting
    let response = null;
    let lastError = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.get(url, {
          params,
          headers: NBA_HEADERS,
          timeout: 10000, // Reduced to 10s to fail faster if NBA.com is slow
          validateStatus: (status) => status < 500
        });
        
        if (response.status === 403 || response.status === 429) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          } else {
            throw new Error(`NBA.com API returned ${response.status}. The API may be rate-limiting requests.`);
          }
        }
        
        break;
      } catch (error) {
        lastError = error;
        if (error.response && (error.response.status === 403 || error.response.status === 429)) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
        }
        if (attempt === 2 || (error.code === 'ECONNABORTED' && attempt >= 1)) {
          throw error;
        }
      }
    }
    
    if (!response) {
      throw lastError || new Error('Failed to fetch game log from NBA.com after retries');
    }
    
    if (!response.data || !response.data.resultSets || !response.data.resultSets[0]) {
      throw new Error('Invalid response from NBA.com API');
    }
    
    const gameLog = response.data.resultSets[0];
    const headers = gameLog.headers || [];
    const games = gameLog.rowSet || [];
    
    // Find column indices - NBA.com playergamelog has many columns
    const gameDateIndex = headers.indexOf('GAME_DATE');
    const matchupIndex = headers.indexOf('MATCHUP');
    const ptsIndex = headers.indexOf('PTS');
    const minIndex = headers.indexOf('MIN');
    const wlIndex = headers.indexOf('WL'); // Win/Loss
    const rebIndex = headers.indexOf('REB');
    const astIndex = headers.indexOf('AST');
    const stlIndex = headers.indexOf('STL');
    const blkIndex = headers.indexOf('BLK');
    const fgmIndex = headers.indexOf('FGM'); // Field Goals Made
    const fgaIndex = headers.indexOf('FGA'); // Field Goals Attempted
    const ftmIndex = headers.indexOf('FTM'); // Free Throws Made
    const ftaIndex = headers.indexOf('FTA'); // Free Throws Attempted
    const fg3mIndex = headers.indexOf('FG3M'); // 3-Pointers Made
    const fg3aIndex = headers.indexOf('FG3A'); // 3-Pointers Attempted
    const tovIndex = headers.indexOf('TOV'); // Turnovers
    const pfIndex = headers.indexOf('PF'); // Personal Fouls
    
    if (ptsIndex === -1) {
      throw new Error('Could not find PTS column in NBA.com response');
    }
    const processGames = (gamesArray, seasonLabel, limit) => {
      return gamesArray.slice(0, limit).map((game, index) => {
      const gameDate = game[gameDateIndex] || '';
      const matchup = game[matchupIndex] || '';
      const points = parseInt(game[ptsIndex]) || 0;
      const minutes = game[minIndex] || '0';
      const result = game[wlIndex] || '';
      const rebounds = parseInt(game[rebIndex]) || 0;
      const assists = parseInt(game[astIndex]) || 0;
      const steals = parseInt(game[stlIndex]) || 0;
      const blocks = parseInt(game[blkIndex]) || 0;
      const field_goals_made = parseInt(game[fgmIndex]) || 0;
      const field_goals_attempted = parseInt(game[fgaIndex]) || 0;
      const free_throws_made = parseInt(game[ftmIndex]) || 0;
      const free_throws_attempted = parseInt(game[ftaIndex]) || 0;
      const three_pointers_made = parseInt(game[fg3mIndex]) || 0;
      const three_pointers_attempted = parseInt(game[fg3aIndex]) || 0;
      const turnovers = parseInt(game[tovIndex]) || 0;
      const personal_fouls = parseInt(game[pfIndex]) || 0;
      
      // Parse opponent from matchup for HISTORICAL game log display only
      // NOTE: For FUTURE games and predictions, use Odds API data instead
      // NBA.com format: "GSW vs. LAL" (GSW is home) or "GSW @ LAL" (GSW is away)
      let opponent = 'N/A';
      let isHome = false;
      
      if (matchup) {
        // Check if it's a home game (contains "vs.")
        if (matchup.includes('vs.')) {
          isHome = true;
          const parts = matchup.split('vs.');
          if (parts.length >= 2) {
            opponent = parts[1].trim();
          }
        } else if (matchup.includes('@')) {
          // Away game
          isHome = false;
          const parts = matchup.split('@');
          if (parts.length >= 2) {
            opponent = parts[1].trim();
          }
        }
        
        // Clean up opponent - extract just the 3-letter team abbreviation
        if (opponent && opponent !== 'N/A') {
          opponent = opponent.trim();
          const teamMatch = opponent.match(/\b([A-Z]{2,3})\b/);
          if (teamMatch) {
            opponent = teamMatch[1];
          } else {
            const firstPart = opponent.split(' ')[0];
            if (firstPart.length >= 2 && firstPart.length <= 3) {
              opponent = firstPart.toUpperCase();
            }
          }
        }
      }
      
      // Format date (NBA.com returns "2025-11-12" format)
      const formattedDate = gameDate || '';
      
      // Normalize keys to standard format (pts, reb, ast, stl, blk, tpm, minutes, opponent)
      return {
        game_number: index + 1,
        date: formattedDate,
        // Standard normalized keys
        pts: points,
        reb: rebounds,
        ast: assists,
        stl: steals,
        blk: blocks,
        tpm: three_pointers_made,
        minutes: minutes,
        opponent: opponent,
        // Legacy keys for backward compatibility
        points: points,
        rebounds: rebounds,
        assists: assists,
        steals: steals,
        blocks: blocks,
        threes_made: three_pointers_made,
        threes: three_pointers_made,
        field_goals_made: field_goals_made,
        fgm: field_goals_made,
        field_goals_attempted: field_goals_attempted,
        fga: field_goals_attempted,
        free_throws_made: free_throws_made,
        ftm: free_throws_made,
        free_throws_attempted: free_throws_attempted,
        fta: free_throws_attempted,
        three_pointers_made: three_pointers_made,
        three_pointers_attempted: three_pointers_attempted,
        tpa: three_pointers_attempted,
        turnovers: turnovers,
        personal_fouls: personal_fouls,
        home: isHome,
        result: result,
        season: seasonLabel
      };
      });
    };

    const processedCurrentGames = processGames(games, currentSeason, currentSeasonGames);

    let processedPreviousGames = [];
    if (includePreviousSeason) {
      try {
        const previousSeason = getPreviousSeason(currentSeason);
        
        const previousResponse = await axios.get(url, {
          params: {
            LeagueID: '00',
            PlayerID: playerId,
            Season: previousSeason,
            SeasonType: 'Regular Season'
          },
          headers: NBA_HEADERS,
          timeout: 15000
        });
        
        if (previousResponse.data?.resultSets?.[0]) {
          const previousGameLog = previousResponse.data.resultSets[0];
          const previousGamesArray = previousGameLog.rowSet || [];
          processedPreviousGames = processGames(previousGamesArray, previousSeason, previousSeasonGames);
        }
      } catch (prevError) {
      }
    }
    
    const processedGames = [...processedCurrentGames, ...processedPreviousGames].map((game, index) => ({
      ...game,
      game_number: index + 1
    }));
    
    return processedGames;
  } catch (error) {
    console.error('❌ Error fetching NBA.com game log:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`Failed to fetch NBA.com game log: ${error.message}`);
  }
}

/**
 * Get player's next scheduled game
 * Uses ESPN's free API (no authentication required)
 * @param {number|null} nbaPlayerId - NBA.com player ID (optional, not needed for ESPN API)
 * @param {string} teamAbbrev - Team abbreviation (required)
 */
export async function getNextGame(nbaPlayerId, teamAbbrev) {
  try {
    // ESPN API only needs team abbreviation, nbaPlayerId is optional
    if (!teamAbbrev || teamAbbrev === 'N/A') {
      return null;
    }
    
    // Map team abbreviation to ESPN team ID
    const espnTeamId = getEspnTeamId(teamAbbrev);
    if (!espnTeamId) {
      return null;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Use ESPN's team schedule endpoint
    try {
      const espnScheduleUrl = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/schedule`;
      const scheduleResponse = await axios.get(espnScheduleUrl, {
        params: {
          region: 'us',
          lang: 'en',
          contentorigin: 'espn'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      if (scheduleResponse.data && scheduleResponse.data.events) {
        const events = scheduleResponse.data.events || [];
        
        // Find next game (future game)
        for (const event of events) {
          if (!event.date) continue;
          
          // Parse game date
          const gameDate = new Date(event.date);
          gameDate.setHours(0, 0, 0, 0);
          
          // Check if this is a future game
          if (gameDate >= today) {
            // This is the next game!
            const competitions = event.competitions || [];
            if (competitions.length > 0) {
              const competition = competitions[0];
              const competitors = competition.competitors || [];
              
              // Find opponent
              let opponent = null;
              let isHome = false;
              
              // Normalize team abbreviation for comparison (ESPN uses GS, UTAH, etc.)
              const normalizedTeamAbbrev = normalizeEspnAbbrev(teamAbbrev);
              
              for (const competitor of competitors) {
                const teamAbbrevFromEspn = competitor.team?.abbreviation || competitor.team?.shortDisplayName || '';
                const normalizedEspnAbbrev = normalizeEspnAbbrev(teamAbbrevFromEspn);
                const isHomeTeam = competitor.homeAway === 'home';
                
                if (normalizedEspnAbbrev === normalizedTeamAbbrev) {
                  isHome = isHomeTeam;
                } else {
                  // Map ESPN abbreviation back to standard NBA abbreviation
                  let mappedOpponent = mapEspnToNbaAbbrev(teamAbbrevFromEspn) || teamAbbrevFromEspn;
                  
                  // Double-check: if mapped opponent is the same as player's team, skip this competitor
                  // This handles cases where ESPN returns inconsistent abbreviations (e.g., SA vs SAS)
                  const isSameTeam = mappedOpponent === teamAbbrev || 
                                    (mappedOpponent === 'SA' && teamAbbrev === 'SAS') || 
                                    (mappedOpponent === 'SAS' && teamAbbrev === 'SA');
                  
                  if (isSameTeam) {
                    continue;
                  }
                  
                  opponent = mappedOpponent;
                }
              }
              
              if (opponent && opponent !== teamAbbrev) {
                // Format date
                const formattedDate = gameDate.toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                });
                
                // Get game time if available
                let gameTime = 'TBD';
                if (event.date) {
                  const timeDate = new Date(event.date);
                  const hours = timeDate.getHours();
                  const minutes = timeDate.getMinutes();
                  if (hours !== 0 || minutes !== 0) {
                    gameTime = timeDate.toLocaleTimeString('en-US', { 
                      hour: 'numeric', 
                      minute: '2-digit',
                      hour12: true 
                    });
                  }
                }
                
                // Get event ID for summary API
                const eventId = event.id || null;
                
                return {
                  opponent: opponent,
                  date: formattedDate,
                  time: gameTime,
                  isHome: isHome,
                  eventId: eventId // Add event ID for summary API
                };
              }
            }
          }
        }
      }
    } catch (espnError) {
      // ESPN schedule endpoint failed - will return null
    }
    return null;
  } catch (error) {
    console.error('Error fetching next game:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

/**
 * Normalize ESPN team abbreviation to standard NBA abbreviation
 */
export function normalizeEspnAbbrev(abbrev) {
  if (!abbrev) return '';
  const upper = abbrev.toUpperCase();
  // ESPN uses GS, UTAH, SA, etc. - normalize to standard
  if (upper === 'GS') return 'GSW';
  if (upper === 'UTAH') return 'UTA';
  if (upper === 'SA') return 'SAS';  // ESPN uses SA for San Antonio Spurs
  return upper;
}

/**
 * Map ESPN abbreviation back to standard NBA abbreviation
 */
export function mapEspnToNbaAbbrev(espnAbbrev) {
  if (!espnAbbrev) return null;
  const upper = espnAbbrev.toUpperCase();
  const mapping = {
    'GS': 'GSW',
    'NY': 'NYK',
    'NO': 'NOP',
    'SA': 'SAS',
    'UTAH': 'UTA',
    'WSH': 'WAS',
  };
  return mapping[upper] || upper;
}

/**
 * Get team record from ESPN API
 */
export async function getTeamRecord(teamAbbrev) {
  try {
    if (!teamAbbrev || teamAbbrev === 'N/A') {
      return null;
    }
    
    const espnTeamId = getEspnTeamId(teamAbbrev);
    if (!espnTeamId) {
      return null;
    }
    
    const teamUrl = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}`;
    const response = await axios.get(teamUrl, {
      params: {
        region: 'us',
        lang: 'en',
        contentorigin: 'espn'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data && response.data.team) {
      const team = response.data.team;
      const record = team.record;
      if (record && record.items && record.items.length > 0) {
        const seasonRecord = record.items[0];
        const wins = seasonRecord.stats?.find(s => s.name === 'wins')?.value || 0;
        const losses = seasonRecord.stats?.find(s => s.name === 'losses')?.value || 0;
        return `${wins}-${losses}`;
      }
    }
    
    return null;
  } catch (error) {
    console.log(`⚠️ Could not fetch team record for ${teamAbbrev}: ${error.message}`);
    return null;
  }
}

/**
 * Get team info (standing, record splits, next game) from ESPN
 */
export async function getTeamInfo(espnTeamId) {
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}`;
    const { data } = await axios.get(url, {
      params: { region: 'us', lang: 'en', contentorigin: 'espn' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'application/json' },
      timeout: 10000
    });
    const team = data?.team;
    if (!team) return {};

    const records = team.record?.items || [];
    const home = records.find(r => r.type === 'home');
    const away = records.find(r => r.type === 'road');
    const ne = team.nextEvent?.[0];

    return {
      standing: team.standingSummary || '',
      homeRecord: home?.summary || '',
      awayRecord: away?.summary || '',
      nextGame: ne ? { id: ne.id, name: ne.shortName || ne.name || '', date: ne.date || '' } : null
    };
  } catch (err) {
    console.log(`⚠️ Could not fetch team info for ${espnTeamId}: ${err.message}`);
    return {};
  }
}

/**
 * Get team season stats from ESPN
 */
export async function getTeamStats(espnTeamId) {
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/statistics`;
    const { data } = await axios.get(url, {
      params: { region: 'us', lang: 'en', contentorigin: 'espn' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'application/json' },
      timeout: 10000
    });

    const categories = data?.results?.stats?.categories || [];
    const all = {};
    for (const cat of categories) {
      for (const s of cat.stats || []) {
        all[s.name] = s.displayValue || '';
      }
    }

    return {
      ppg: all.avgPoints || '',
      rpg: all.avgRebounds || '',
      apg: all.avgAssists || '',
      spg: all.avgSteals || '',
      bpg: all.avgBlocks || '',
      topg: all.avgTurnovers || '',
      fgPct: all.fieldGoalPct || '',
      threePtPct: all.threePointPct || '',
      ftPct: all.freeThrowPct || '',
      offRpg: all.avgOffensiveRebounds || '',
      defRpg: all.avgDefensiveRebounds || '',
      pfpg: all.avgFouls || '',
      astToRatio: all.assistTurnoverRatio || '',
    };
  } catch (err) {
    console.log(`⚠️ Could not fetch team stats for ${espnTeamId}: ${err.message}`);
    return {};
  }
}

/**
 * Get team schedule from ESPN
 */
export async function getTeamSchedule(espnTeamId) {
  try {
    const cacheKey = `schedule:${espnTeamId}`;
    const cached = teamSearchCache.get(cacheKey);
    if (cached) return cached;

    const url = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/schedule`;
    const { data } = await axios.get(url, {
      params: { region: 'us', lang: 'en', contentorigin: 'espn' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'application/json' },
      timeout: 10000
    });

    const schedule = (data.events || []).map(e => {
      const comp = e.competitions?.[0];
      if (!comp) return null;
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      const status = comp.status?.type;
      return {
        id: e.id,
        date: e.date,
        name: e.shortName || e.name || '',
        home: { abbrev: home?.team?.abbreviation || '', score: home?.score?.displayValue || '' },
        away: { abbrev: away?.team?.abbreviation || '', score: away?.score?.displayValue || '' },
        status: status?.completed ? 'final' : status?.name === 'STATUS_SCHEDULED' ? 'scheduled' : 'in_progress',
        statusDetail: status?.shortDetail || '',
        isHome: home?.team?.id === espnTeamId,
      };
    }).filter(Boolean);

    teamSearchCache.set(cacheKey, schedule, 3600);
    return schedule;
  } catch (err) {
    console.log(`⚠️ Could not fetch team schedule for ${espnTeamId}: ${err.message}`);
    return [];
  }
}

/**
 * Get ESPN team ID from NBA team abbreviation
 * Note: ESPN uses different abbreviations for some teams (e.g., GS instead of GSW, UTAH instead of UTA)
 */
export function getEspnTeamId(abbrev) {
  const teamMap = {
    'ATL': '1',      // Atlanta Hawks
    'BOS': '2',      // Boston Celtics
    'BKN': '17',     // Brooklyn Nets
    'CHA': '30',     // Charlotte Hornets
    'CHI': '4',      // Chicago Bulls
    'CLE': '5',      // Cleveland Cavaliers
    'DAL': '6',      // Dallas Mavericks
    'DEN': '7',      // Denver Nuggets
    'DET': '8',      // Detroit Pistons
    'GSW': '9',      // Golden State Warriors (ESPN uses "GS" but we map GSW -> 9)
    'GS': '9',       // Golden State Warriors (ESPN abbreviation)
    'HOU': '10',     // Houston Rockets
    'IND': '11',     // Indiana Pacers
    'LAC': '12',     // LA Clippers
    'LAL': '13',     // Los Angeles Lakers
    'MEM': '29',     // Memphis Grizzlies
    'MIA': '14',     // Miami Heat
    'MIL': '15',     // Milwaukee Bucks
    'MIN': '16',     // Minnesota Timberwolves
    'NO': '3',       // New Orleans Pelicans
    'NOP': '3',      // New Orleans Pelicans
    'NYK': '18',     // New York Knicks
    'OKC': '25',     // Oklahoma City Thunder
    'ORL': '19',     // Orlando Magic
    'PHI': '20',     // Philadelphia 76ers
    'PHX': '21',     // Phoenix Suns
    'POR': '22',     // Portland Trail Blazers
    'SAC': '23',     // Sacramento Kings
    'SA': '24',      // San Antonio Spurs
    'SAS': '24',     // San Antonio Spurs
    'TOR': '28',     // Toronto Raptors
    'UTA': '26',     // Utah Jazz
    'UTAH': '26',    // Utah Jazz (ESPN abbreviation)
    'WAS': '27',     // Washington Wizards
    'WSH': '27'      // Washington Wizards (alternative abbreviation)
  };
  
  return teamMap[abbrev.toUpperCase()] || null;
}

/**
 * Get team ID from abbreviation
 */
function getTeamIdFromAbbrev(abbrev) {
  const teamMap = {
    'ATL': 1610612737,
    'BOS': 1610612738,
    'BKN': 1610612751,
    'CHA': 1610612766,
    'CHI': 1610612741,
    'CLE': 1610612739,
    'DAL': 1610612742,
    'DEN': 1610612743,
    'DET': 1610612765,
    'GSW': 1610612744,
    'HOU': 1610612745,
    'IND': 1610612754,
    'LAC': 1610612746,
    'LAL': 1610612747,
    'MEM': 1610612763,
    'MIA': 1610612748,
    'MIL': 1610612749,
    'MIN': 1610612750,
    'NO': 1610612740,
    'NOP': 1610612740,
    'NYK': 1610612752,
    'OKC': 1610612760,
    'ORL': 1610612753,
    'PHI': 1610612755,
    'PHX': 1610612756,
    'POR': 1610612757,
    'SAC': 1610612758,
    'SA': 1610612759,
    'SAS': 1610612759,
    'TOR': 1610612761,
    'UTA': 1610612762,
    'WAS': 1610612764
  };
  
  return teamMap[abbrev.toUpperCase()] || null;
}

/**
 * Format game date from NBA.com format
 */
function formatGameDate(dateStr) {
  if (!dateStr) return 'TBD';
  try {
    // NBA.com format: "20251112" -> "Nov 12, 2025"
    if (dateStr.length === 8) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      const date = new Date(`${year}-${month}-${day}`);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return dateStr;
  } catch (e) {
    return dateStr;
  }
}

/**
 * Get current NBA season (e.g., "2024-25")
 */
function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  // NBA season runs from October to June
  // If we're before October, use previous season
  if (month < 10) {
    return `${year - 1}-${String(year).slice(-2)}`;
  } else {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
}

/**
 * Get previous NBA season string given current season (e.g., "2024-25" -> "2023-24")
 */
function getPreviousSeason(season) {
  if (!season || !season.includes('-')) {
    const current = getCurrentSeason();
    return getPreviousSeason(current);
  }
  
  const [start, end] = season.split('-');
  const startYear = parseInt(start, 10);
  const previousStartYear = startYear - 1;
  const previousEndYearShort = String(startYear).slice(-2);
  return `${previousStartYear}-${previousEndYearShort}`;
}

/**
 * Get player info by ID
 */
export async function getPlayerInfo(playerId) {
  try {
    const url = `${NBA_API_BASE}/commonplayerinfo`;
    const params = {
      PlayerID: playerId
    };
    
    // Try with longer timeout and retry logic
    let response = null;
    let lastError = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.get(url, {
          params,
          headers: NBA_HEADERS,
          timeout: 30000, // Increased timeout to 30s for slow API responses
          validateStatus: (status) => status < 500 // Don't throw on 403/404, handle it
        });
        
        // Check if we got a valid response
        if (response.status === 403 || response.status === 429) {
          // Rate limited or blocked - wait a bit and retry
          if (attempt < 2) {
            console.log(`⚠️ NBA.com returned ${response.status}, waiting before retry ${attempt + 1}/3...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1))); // Exponential backoff
            continue;
          } else {
            throw new Error(`NBA.com API returned ${response.status}. The API may be rate-limiting requests.`);
          }
        }
        
        // Success
        break;
      } catch (error) {
        lastError = error;
        if (error.response && (error.response.status === 403 || error.response.status === 429)) {
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
        }
        // If it's a timeout or other error, throw immediately
        if (attempt === 2 || error.code === 'ECONNABORTED') {
          throw error;
        }
      }
    }
    
    if (!response) {
      throw lastError || new Error('Failed to fetch from NBA.com after retries');
    }
    
    if (response.data && response.data.resultSets && response.data.resultSets[0]) {
      const playerData = response.data.resultSets[0].rowSet[0];
      const headers = response.data.resultSets[0].headers;
      
      return {
        id: playerId,
        first_name: playerData[headers.indexOf('FIRST_NAME')] || '',
        last_name: playerData[headers.indexOf('LAST_NAME')] || '',
        display_name: playerData[headers.indexOf('DISPLAY_FIRST_LAST')] || '',
        team: playerData[headers.indexOf('TEAM_ABBREVIATION')] || 'N/A',
        position: playerData[headers.indexOf('POSITION')] || 'N/A'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching player info:', error.message);
    throw error;
  }
}

// Cache for team searches (1 hour)
const teamSearchCache = new NodeCache({ stdTTL: 3600, useClones: false });

/**
 * Search for NBA teams by name, city, or abbreviation using ESPN API
 */
export async function searchTeamsESPN(query) {
  try {
    const searchTerm = query.toLowerCase().trim();

    // Try to use cached teams list
    let teams = teamSearchCache.get('all_teams');
    if (!teams) {
      const teamsUrl = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
      const response = await axios.get(teamsUrl, {
        params: { region: 'us', lang: 'en', contentorigin: 'espn', limit: 50 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const leagues = response.data?.sports?.[0]?.leagues || [];
      teams = (leagues[0]?.teams || []).map((t) => t.team).filter(Boolean);
      teamSearchCache.set('all_teams', teams);
    }

    const results = teams
      .filter((team) => {
        const abbrev = (team.abbreviation || '').toLowerCase();
        const displayName = (team.displayName || '').toLowerCase();
        const shortName = (team.shortDisplayName || '').toLowerCase();
        const location = (team.location || '').toLowerCase();
        const nickname = (team.name || '').toLowerCase();
        return (
          abbrev.includes(searchTerm) ||
          displayName.includes(searchTerm) ||
          shortName.includes(searchTerm) ||
          location.includes(searchTerm) ||
          nickname.includes(searchTerm)
        );
      })
      .map((team) => ({
        id: team.id,
        abbreviation: team.abbreviation,
        displayName: team.displayName,
        shortDisplayName: team.shortDisplayName,
        location: team.location,
        nickname: team.name,
        logo: team.logos?.[0]?.href || null,
        record: team.record?.items?.[0]?.summary || null,
      }));

    return results;
  } catch (error) {
    console.error('❌ Error searching teams:', error.message);
    return [];
  }
}

/**
 * Get full roster for a team by ESPN team ID
 */
export async function getTeamRoster(espnTeamId) {
  try {
    const cacheKey = `roster:${espnTeamId}`;
    const cached = teamSearchCache.get(cacheKey);
    if (cached) return cached;

    const rosterUrl = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/roster`;
    const response = await axios.get(rosterUrl, {
      params: { region: 'us', lang: 'en', contentorigin: 'espn' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const athletesGroups = Array.isArray(response.data?.athletes) ? response.data.athletes : [];
    const athletes = athletesGroups.flatMap((group) => {
      if (!group) return [];
      return Array.isArray(group.items) ? group.items : group;
    });

    const roster = athletes.map((athlete) => {
      const base = athlete.athlete || athlete;
      const positionInfo = athlete.position || base.position || {};
      const salary = base.contract?.salary;
      return {
        id: base.id || athlete.id,
        firstName: base.firstName || '',
        lastName: base.lastName || '',
        displayName: base.displayName || `${base.firstName || ''} ${base.lastName || ''}`.trim(),
        position: positionInfo.abbreviation || positionInfo.name || 'N/A',
        jersey: base.jersey || athlete.jersey || null,
        headshot: base.headshot?.href || base.headshot || null,
        age: base.age || null,
        height: base.displayHeight || null,
        weight: base.displayWeight || null,
        college: base.college?.shortName || base.college?.name || null,
        salary: salary ? `$${salary.toLocaleString()}` : null,
        injuries: base.injuries || [],
      };
    });

    // Cache for 6 hours
    teamSearchCache.set(cacheKey, roster, 21600);
    return roster;
  } catch (error) {
    console.error(`❌ Error fetching roster for team ${espnTeamId}:`, error.message);
    return [];
  }
}

