import express from 'express';
import { getPlayerStats, getTeamRecord, searchPlayer, searchPlayersESPN } from '../services/nbaApiService.js';
import { getPlayerOdds } from '../services/oddsService.js';
import { predictPointsFromGames } from '../services/predictionService.js';
import { 
  playerStatsCache, 
  predictionsCache, 
  bettingLinesCache, 
  nextGamesCache,
  playersWithLinesCache,
  imageMetadataCache,
  createGamesHash 
} from '../services/databaseService.js';
import { getImageUrl, imageExists, downloadPlayerImage } from '../services/imageStorageService.js';
import {
  getAccuracyStats,
  updatePredictionOutcome,
  getPendingEvaluations,
  exportForRetraining
} from '../services/predictionTrackingService.js';
import { 
  evaluatePendingPredictions,
  evaluatePredictionById,
  evaluatePredictionByGame
} from '../services/predictionEvaluationService.js';
import { getTeamAbbrevFromFullName } from '../services/teamMappingService.js';
import { getMatchupInjuries } from '../services/injuryService.js';
import { generatePropPrediction } from '../services/compareService.js';
import { getTeamLogo, getTeamName } from '../services/teamLogoService.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

/**
 * GET /api/player/with-lines
 * Get list of players with current betting lines available
 */
router.get('/with-lines', async (req, res) => {
  try {
    if (!THE_ODDS_API_KEY) {
      return res.json([]); // Return empty if no API key
    }

    // Check cache first
    const cached = playersWithLinesCache.get();
    if (cached) {
      return res.json(cached);
    }

    // Step 1: Get all NBA events
    const eventsResponse = await axios.get(`${THE_ODDS_API_BASE}/sports/basketball_nba/events`, {
      params: { apiKey: THE_ODDS_API_KEY },
      timeout: 15000
    });

    if (!eventsResponse.data || !Array.isArray(eventsResponse.data)) {
      return res.json([]);
    }

    const events = eventsResponse.data.slice(0, 10); // Limit to first 10 events to avoid too many API calls

    const playersWithLines = [];
    const seenPlayers = new Set();

    // Step 2: Fetch all event odds in parallel (much faster than sequential)
    const oddsResults = await Promise.allSettled(
      events.map(event =>
        axios.get(`${THE_ODDS_API_BASE}/sports/basketball_nba/events/${event.id}/odds`, {
          params: {
            apiKey: THE_ODDS_API_KEY,
            regions: 'us',
            markets: 'player_points',
            oddsFormat: 'american'
          },
          timeout: 10000
        }).then(res => ({ event, data: res.data }))
      )
    );

    for (const result of oddsResults) {
      if (result.status !== 'fulfilled') continue;
      const { event, data } = result.value;
      if (!data?.bookmakers?.length) continue;

      for (const bookmaker of data.bookmakers) {
        for (const market of bookmaker.markets || []) {
          if (market.key !== 'player_points') continue;

          for (const outcome of market.outcomes || []) {
            const playerName = outcome.description;
            if (!playerName || seenPlayers.has(playerName.toLowerCase())) continue;

            const line = parseFloat(outcome.point);
            if (isNaN(line) || line <= 0) continue;

            seenPlayers.add(playerName.toLowerCase());
            playersWithLines.push({
              name: playerName,
              betting_line: line,
              prop_type: 'points',
              bookmaker: bookmaker.title || bookmaker.key,
              event_id: event.id,
              home_team: event.home_team,
              away_team: event.away_team,
              commence_time: event.commence_time,
              player_image: null
            });
          }
        }
      }
    }

    // Step 3: Download and store player images locally (using ESPN to avoid NBA.com rate limits)
    // Using static imports from top of file
    
    // Process images in smaller batches to avoid overwhelming APIs
    const batchSize = 5;
    for (let i = 0; i < playersWithLines.length; i += batchSize) {
      const batch = playersWithLines.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map(async (player) => {
          try {
            // Check if image already exists locally
            if (imageExists(player.name)) {
              player.player_image = getImageUrl(player.name);
              return;
            }
            
            // Use ESPN search to find player (more reliable than NBA.com)
            const espnResults = await searchPlayersESPN(player.name);
            if (espnResults && espnResults.length > 0) {
              const espnPlayer = espnResults[0];
              
              // Try to get NBA ID from ESPN player data if available
              // ESPN sometimes includes external IDs, but we'll need to search NBA.com
              // For now, try NBA.com search with short timeout
              try {
                // Using static import from top of file
                const searchPromise = searchPlayer(player.name);
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('timeout')), 3000)
                );
                
                const nbaPlayer = await Promise.race([searchPromise, timeoutPromise]);
                if (nbaPlayer && nbaPlayer.id) {
                  const imageUrl = await downloadPlayerImage(player.name, nbaPlayer.id);
                  if (imageUrl) {
                    player.player_image = imageUrl;
                  }
                }
              } catch (nbaError) {
                // If NBA.com search fails, skip image for this player
                // They'll just use initials
              }
            }
          } catch (error) {
            // Silently fail - player will just have no image
          }
        })
      );
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < playersWithLines.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Cache the results
    playersWithLinesCache.set(playersWithLines);
    
    res.json(playersWithLines);
  } catch (error) {
    console.error('❌ Error fetching players with lines:', error.message);
    res.json([]); // Return empty array on error
  }
});

/**
 * GET /api/player/:id/stats
 * Fetch last 10 games for a player
 * Requires player name as query parameter
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const playerName = req.query.name;
    if (!playerName) {
      return res.status(400).json({ error: 'Player name (name query parameter) is required' });
    }
    const stats = await getPlayerStats(playerName);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch player stats' });
  }
});

/**
 * GET /api/player/:id/prediction
 * Compute prediction from player stats
 * Requires player name as query parameter
 */
router.get('/:id/prediction', async (req, res) => {
  try {
    const playerName = req.query.name;
    if (!playerName) {
      return res.status(400).json({ error: 'Player name (name query parameter) is required' });
    }
    const stats = await getPlayerStats(playerName);
    if (!stats.games || stats.games.length < 3) {
      return res.status(400).json({ error: `Insufficient game data. Need at least 3 games, got ${stats.games?.length || 0}` });
    }
    const prediction = await predictPointsFromGames(stats.games, playerName, null, null, null);
    res.json(prediction);
  } catch (error) {
    console.error('Error generating prediction:', error);
    res.status(500).json({ error: error.message || 'Failed to generate prediction' });
  }
});

/**
 * GET /api/player/:id/prediction/:propType
 * Generate prediction for a specific prop type on demand (lazy loading)
 * Requires player name as query parameter
 */
router.get('/:id/prediction/:propType', async (req, res) => {
  try {
    const playerName = req.query.name;
    const propType = req.params.propType; // e.g., 'points', 'assists', 'rebounds', etc.
    
    if (!playerName) {
      return res.status(400).json({ error: 'Player name (name query parameter) is required' });
    }
    
    if (!propType) {
      return res.status(400).json({ error: 'Prop type is required' });
    }
    
    // Get player stats
    // Using static import from top of file
    const stats = await getPlayerStats(playerName);
    
    if (!stats.games || stats.games.length < 3) {
      return res.status(400).json({ error: `Insufficient game data. Need at least 3 games, got ${stats.games?.length || 0}` });
    }
    
    // Get team abbreviation - next game info will come from Odds API
    const teamAbbrev = stats.player?.team?.abbreviation || stats.team || null;
    
    // Next game info will be populated from Odds API when we fetch betting lines
    let nextGame = null;
    let nextGameInfo = null;
    
    // Get injury data - will be populated after we have Odds API game info
    let injuryData = null;
    
    // Create cache key
    const injuryHash = injuryData 
      ? JSON.stringify({
          playerTeam: injuryData.playerTeamInjuries.map(i => i.playerName).sort(),
          opponent: injuryData.opponentInjuries.map(i => i.playerName).sort()
        })
      : 'no_injuries';
    const gamesHash = createGamesHash(stats.games);
    const cacheKey = `${gamesHash}_${injuryHash}_${propType}`;
    
    // Check cache first
    let prediction = predictionsCache.get(playerName, cacheKey);
    
    if (!prediction) {
      // Get the CORRECT vegas line for this specific prop from The Odds API
      // ALSO extract game info for matchup data
      let bettingLine = null;
      try {
        // Using static import from top of file
        const oddsResult = await getPlayerOdds(null, playerName);
        bettingLine = oddsResult?.[propType]?.line || null;
        
        // Extract game info from Odds API if available
        if (oddsResult?._gameInfo) {
          const gameInfo = oddsResult._gameInfo;
          // Using static import from top of file
          const homeTeamAbbrev = getTeamAbbrevFromFullName(gameInfo.home_team);
          const awayTeamAbbrev = getTeamAbbrevFromFullName(gameInfo.away_team);
          
          if (homeTeamAbbrev && awayTeamAbbrev && teamAbbrev) {
            const isHome = teamAbbrev === homeTeamAbbrev;
            const opponent = isHome ? awayTeamAbbrev : homeTeamAbbrev;
            
            const gameDate = new Date(gameInfo.commence_time);
            nextGame = {
              opponent: opponent,
              date: gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              time: gameDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              isHome: isHome,
              eventId: gameInfo.event_id
            };
            
            nextGameInfo = {
              date: nextGame.date,
              opponent: opponent,
              isHome: isHome,
              team: teamAbbrev
            };
            
          }
        }
      } catch (oddsError) {
        // Continue without betting line - compareService will handle unavailable status
      }
      
      // Generate prediction using compareService - ensures we use ONLY the correct vegas line
      try {
        // Using static import from top of file
        const propPrediction = await generatePropPrediction(
          stats.games,
          playerName,
          propType,
          nextGameInfo,
          injuryData,
          bettingLine  // ONLY use The Odds API line for this specific prop
        );
        
        // Convert to format expected by frontend
        prediction = {
          [`predicted_${propType}`]: propPrediction.predicted_value,
          predicted_value: propPrediction.predicted_value,
          // For backward compatibility with points
          predicted_points: propType === 'points' ? propPrediction.predicted_value : null,
          confidence: propPrediction.confidence,
          error_margin: propPrediction.error_margin,
          errorMargin: propPrediction.error_margin,
          recommendation: propPrediction.recommendation,
          analysis: propPrediction.analysis || null,
          stats: propPrediction.stats || null,
          status: propPrediction.status || null
        };
        
        if (prediction) {
          predictionsCache.set(playerName, cacheKey, prediction);
        } else {
          throw new Error(`Prediction service returned null for ${propType}`);
        }
      } catch (predError) {
        console.error(`❌ Error generating ${propType} prediction:`, predError);
        console.error(`   Stack:`, predError.stack);
        throw predError;
      }
    } else {
    }
    
    res.json(prediction);
  } catch (error) {
    console.error(`❌ Error generating ${req.params.propType} prediction:`, error);
    console.error(`   Stack:`, error.stack);
    res.status(500).json({ 
      error: error.message || `Failed to generate ${req.params.propType} prediction`,
      propType: req.params.propType,
      playerName: req.query.name
    });
  }
});

/**
 * GET /api/player/:id/odds
 * Fetch player prop line from The Odds API
 */
router.get('/:id/odds', async (req, res) => {
  try {
    const playerId = req.params.id;
    const odds = await getPlayerOdds(playerId);
    res.json(odds);
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch odds' });
  }
});

/**
 * GET /api/player/:id/compare
 * Return combined object with stats, prediction, odds, and recommendation
 * Requires player name as query parameter
 */
router.get('/:id/compare', async (req, res) => {
  try {
    const playerName = req.query.name;
    if (!playerName) {
      return res.status(400).json({ error: 'Player name (name query parameter) is required' });
    }
    
    // 1. Get player stats (check cache first)
    let stats = playerStatsCache.get(playerName);
    if (!stats) {
      stats = await getPlayerStats(playerName);
      if (stats) {
        const nbaPlayerId = stats.player?.nba_id || stats.player?.id;
        const teamAbbrev = typeof stats.player?.team === 'string' 
          ? stats.player.team 
          : stats.player?.team?.abbreviation;
        playerStatsCache.set(playerName, stats, nbaPlayerId, teamAbbrev);
      }
    }
    
    if (!stats || !stats.games || stats.games.length < 3) {
      throw new Error(`Insufficient game data. Need at least 3 games, got ${stats?.games?.length || 0}.`);
    }
    
    // Normalize game results so frontend always receives a value (W/L) for score column
    const normalizedGames = stats.games.map((game) => {
      const fallbackResult = game?.win_loss || game?.wl || game?.game_result || null;
      return {
        ...game,
        result: (typeof game.result === 'string' && game.result.trim() !== '')
          ? game.result
          : (typeof fallbackResult === 'string' && fallbackResult.trim() !== '' ? fallbackResult : null)
      };
    });
    stats = {
      ...stats,
      games: normalizedGames
    };
    
    // Extract player name and team info
    const finalPlayerName = `${stats.player.first_name} ${stats.player.last_name}`.trim() || playerName;
    
    // Try to get team abbreviation from multiple sources
    let teamAbbrev = null;
    if (typeof stats.player?.team === 'string') {
      teamAbbrev = stats.player.team;
    } else if (stats.player?.team?.abbreviation) {
      teamAbbrev = stats.player.team.abbreviation;
    }
    
    // 2. Get next game - will be populated from Odds API _gameInfo
    // NO LONGER using ESPN getNextGame - Odds API is the only source
    let nextGame = null;
    
    // 2b. Prepare variables for team records and injury data
    // Opponent record and injury data will be fetched AFTER nextGame is populated from Odds API
    let playerTeamRecord = null;
    let opponentRecord = null;
    let injuryData = null;
    
    // 3. Get betting odds from The Odds API ONLY (in parallel with player team record)
    // Returns an object with all props: { points: {...}, assists: {...}, rebounds: {...}, etc. }
    let allProps = {}; // Initialize to empty object
    let odds = null; // Backward compatibility: points prop only
    
    // Check cache first (only use if it's from API, not homepage)
    const cachedOdds = bettingLinesCache.get(finalPlayerName, teamAbbrev, nextGame?.opponent);
    if (cachedOdds && cachedOdds.line && cachedOdds.source !== 'homepage') {
      // Convert cached single prop to new format
      allProps = {
        points: cachedOdds
      };
      odds = cachedOdds;
    }
    
    // Fetch odds and player team record in parallel (they don't depend on each other)
    const [oddsResult, playerTeamRecordResult] = await Promise.allSettled([
      // Always fetch from The Odds API - this is the ONLY source of truth
      getPlayerOdds(null, finalPlayerName, {
        teamAbbrev: teamAbbrev,
        opponentAbbrev: nextGame?.opponent || null
      }),
      // Get player team record (can fetch immediately since we have teamAbbrev)
      (teamAbbrev && teamAbbrev !== 'N/A') 
        ? getTeamRecord(teamAbbrev).catch(error => {
            console.error(`Error fetching player team record for ${teamAbbrev}:`, error.message);
            return null;
          })
        : Promise.resolve(null)
    ]);
    
    // Extract player team record
    playerTeamRecord = playerTeamRecordResult.status === 'fulfilled' ? playerTeamRecordResult.value : null;
    
    // Process odds result
    try {
      const oddsData = oddsResult.status === 'fulfilled' ? oddsResult.value : null;
      
      if (oddsData && typeof oddsData === 'object' && Object.keys(oddsData).length > 0) {
        // Extract game info from Odds API - THIS IS NOW THE ONLY SOURCE FOR MATCHUP DATA
        if (oddsData._gameInfo) {
          const gameInfo = oddsData._gameInfo;
          try {
            // Convert Odds API full team names to abbreviations (using static import)
            const homeTeamAbbrev = getTeamAbbrevFromFullName(gameInfo.home_team);
            const awayTeamAbbrev = getTeamAbbrevFromFullName(gameInfo.away_team);

            // If we don't have teamAbbrev from ESPN, determine it from the Odds API game
            if (!teamAbbrev) {
              teamAbbrev = homeTeamAbbrev || awayTeamAbbrev;
            }
            
            // ALWAYS override nextGame with Odds API data (this is our source of truth)
            if (homeTeamAbbrev && awayTeamAbbrev) {
              const isHome = teamAbbrev === homeTeamAbbrev;
              const opponent = isHome ? awayTeamAbbrev : homeTeamAbbrev;
              
              const gameDate = new Date(gameInfo.commence_time);
              nextGame = {
                opponent: opponent,
                date: gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                time: gameDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
                isHome: isHome,
                eventId: gameInfo.event_id,
                home_team: homeTeamAbbrev,
                away_team: awayTeamAbbrev,
                commence_time: gameInfo.commence_time
              };
              
              // Now that we have nextGame populated, fetch opponent record and injury data in parallel
              const [opponentRecordResult, matchupInjuriesResult] = await Promise.allSettled([
                // Get opponent record
                nextGame.opponent ? getTeamRecord(nextGame.opponent) : Promise.resolve(null),
                // Get injury data
                (teamAbbrev && teamAbbrev !== 'N/A' && nextGame.opponent) 
                  ? getMatchupInjuries(teamAbbrev, nextGame.opponent, nextGame.eventId || null)
                  : Promise.resolve({ playerTeamInjuries: [], opponentInjuries: [], hasPlayerTeamInjuries: false, hasOpponentInjuries: false })
              ]);
              
              // Extract opponent record
              opponentRecord = opponentRecordResult.status === 'fulfilled' ? opponentRecordResult.value : null;
              
              // Process injury data
              if (matchupInjuriesResult.status === 'fulfilled') {
                const matchupInjuries = matchupInjuriesResult.value;
                if (matchupInjuries.hasPlayerTeamInjuries || matchupInjuries.hasOpponentInjuries) {
                  injuryData = {
                    playerTeamInjuries: matchupInjuries.playerTeamInjuries,
                    opponentInjuries: matchupInjuries.opponentInjuries,
                    playerTeamAbbrev: teamAbbrev,
                    opponentAbbrev: nextGame.opponent
                  };
                }
              }
            }
          } catch (mappingError) {
            console.error(`❌ Error mapping Odds API game info:`, mappingError.message);
          }
        }
        
        // Use ONLY API results - no merging, no fallbacks, no validation
        allProps = oddsData;
        
        // Remove the _gameInfo metadata from props (it's not a prop)
        delete allProps._gameInfo;
        
        // Extract points prop for backward compatibility
        odds = oddsData.points || null;
        
        // Cache the points prop
        if (odds && odds.line) {
          bettingLinesCache.set(
            finalPlayerName, 
            odds.line, 
            odds.bookmaker, 
            odds.source || 'theoddsapi', 
            odds.event_id,
            teamAbbrev, 
            nextGame?.opponent
          );
        }
      }
    } catch (oddsError) {
      // Silently use cache if API fails
      if (Object.keys(allProps).length === 0 && cachedOdds && cachedOdds.line) {
        allProps = { points: cachedOdds };
        odds = cachedOdds;
      }
    }

    // 4. Generate predictions for all available props (after we know which props exist)
    // Prepare next game info for tracking
    const nextGameInfo = nextGame ? {
      date: nextGame.date || null,
      opponent: nextGame.opponent || null,
      isHome: nextGame.isHome || null,
      team: teamAbbrev || null
    } : null;
    
    // Create cache key that includes injury data (injuries change frequently)
    const injuryHash = injuryData 
      ? JSON.stringify({
          playerTeam: injuryData.playerTeamInjuries.map(i => i.playerName).sort(),
          opponent: injuryData.opponentInjuries.map(i => i.playerName).sort()
        })
      : 'no_injuries';
    const gamesHash = createGamesHash(stats.games);
    
    // Get all available prop types (from betting lines we just fetched)
    const availablePropTypes = Object.keys(allProps || {});
    
    // LAZY LOADING: Only generate points prediction on initial load for faster page load
    // Other prop predictions will be generated on-demand when user clicks on that prop tab
    let prediction = null;
    let allPredictions = {}; // Store predictions for all props
    
    // Always generate points prediction (for backward compatibility and initial display)
    // Use compareService to ensure we use ONLY the correct vegas line for points prop
    const pointsCacheKey = `${gamesHash}_${injuryHash}_points`;
    prediction = predictionsCache.get(playerName, pointsCacheKey);
    if (!prediction) {
      // Get betting line for points prop ONLY from The Odds API
      const pointsBettingLine = allProps?.points?.line || null;
      
      // Use compareService to generate prediction with correct line
      // Using static import from top of file
      const pointsPrediction = await generatePropPrediction(
        stats.games,
        finalPlayerName,
        'points',
        nextGameInfo,
        injuryData,
        pointsBettingLine  // ONLY use The Odds API line for points
      );
      
      // Convert to format expected by frontend
      prediction = {
        predicted_points: pointsPrediction.predicted_value,
        predictedPoints: pointsPrediction.predicted_value,
        confidence: pointsPrediction.confidence,
        error_margin: pointsPrediction.error_margin,
        errorMargin: pointsPrediction.error_margin,
        recommendation: pointsPrediction.recommendation,
        analysis: pointsPrediction.analysis || null,
        stats: pointsPrediction.stats || null
      };
      
      if (prediction.predicted_points != null) {
        predictionsCache.set(playerName, pointsCacheKey, prediction);
      }
    }
    allPredictions.points = prediction;
    
    // Check cache for other props (but don't generate them - lazy load on demand)
    // This allows us to show cached predictions if available, but not block page load
    for (const propType of availablePropTypes) {
      if (propType !== 'points') {
        const cacheKey = `${gamesHash}_${injuryHash}_${propType}`;
        const cached = predictionsCache.get(playerName, cacheKey);
        if (cached) {
          allPredictions[propType] = cached;
        }
        // If not cached, we'll generate it on-demand when user clicks that prop tab
      }
    }

    // Use the playerName we already extracted, or fallback
    if (!playerName) {
      playerName = 'Unknown';
      if (stats?.player) {
        playerName = typeof stats.player === 'string' 
          ? stats.player 
          : `${stats.player.first_name || ''} ${stats.player.last_name || ''}`.trim();
      } else if (prediction?.player) {
        playerName = prediction.player;
      } else if (odds?.player) {
        playerName = odds.player;
      }
    }

    // Extract predicted points and betting line
    const predictedPoints = prediction?.predicted_points || prediction?.predictedPoints || null;
    const bettingLine = odds?.line || (allProps?.points?.line) || null;
    
    // Use recommendation from prediction service (if available)
    // Fallback to manual calculation for backward compatibility
    let recommendation = prediction?.recommendation || 'N/A';
    if (recommendation === 'N/A' || !recommendation) {
      if (predictedPoints !== null && bettingLine !== null) {
        if (predictedPoints > bettingLine) {
          recommendation = 'OVER';
        } else if (predictedPoints < bettingLine) {
          recommendation = 'UNDER';
        } else {
          recommendation = 'PUSH';
        }
      }
    }

    // Get team logos (using static import from top of file)
    
    const opponentTeam = nextGame?.opponent || null;
    
    // Get player team from stats
    let finalPlayerTeam = null;
    if (stats?.player) {
      if (typeof stats.player === 'object') {
        finalPlayerTeam = stats.player.team || stats.player.team?.abbreviation || null;
      }
    }
    // Fallback to prediction
    if (!finalPlayerTeam && prediction?.player_team) {
      finalPlayerTeam = prediction.player_team;
    }
    
    // Convert full position name to abbreviation
    const abbreviatePosition = (pos) => {
      if (!pos || pos === 'N/A') return null;
      const map = { 'guard': 'G', 'forward': 'F', 'center': 'C', 'point guard': 'PG', 'shooting guard': 'SG', 'small forward': 'SF', 'power forward': 'PF' };
      const lower = pos.toLowerCase().trim();
      if (map[lower]) return map[lower];
      // Handle compound positions like "Forward-Guard" or "Guard-Forward"
      if (lower.includes('-')) {
        return lower.split('-').map(p => map[p.trim()] || p.trim().charAt(0).toUpperCase()).join('-');
      }
      // Already abbreviated (e.g., "G", "F", "C")
      if (pos.length <= 3) return pos;
      return pos;
    };

    const response = {
      player: finalPlayerName,
      position: abbreviatePosition(stats?.player?.position) || 'N/A',
      stats: stats?.games || stats?.stats || [],
      prediction: predictedPoints,
      betting_line: bettingLine, // Backward compatibility: points line only
      recommendation,
      confidence: prediction?.confidence || null,
      error_margin: prediction?.error_margin || prediction?.errorMargin || null,
      next_game: nextGame ? {
        ...nextGame,
        // Standardized matchup fields from Odds API
        player_team: finalPlayerTeam,
        opponent_team: nextGame.opponent,
        is_home: nextGame.isHome,
        home_team: nextGame.home_team || (nextGame.isHome ? finalPlayerTeam : nextGame.opponent),
        away_team: nextGame.away_team || (nextGame.isHome ? nextGame.opponent : finalPlayerTeam),
        commence_time: nextGame.commence_time || null,
        display_matchup: nextGame.isHome 
          ? `${finalPlayerTeam} vs ${nextGame.opponent}` 
          : `${finalPlayerTeam} @ ${nextGame.opponent}`,
        // Additional display info
        opponent_logo: getTeamLogo(opponentTeam),
        opponent_name: getTeamName(opponentTeam),
        opponent_record: opponentRecord
      } : null,
      player_team: finalPlayerTeam,
      player_team_logo: getTeamLogo(finalPlayerTeam),
      player_team_name: getTeamName(finalPlayerTeam),
      player_team_record: playerTeamRecord,
      odds_source: odds?.source || null,
      odds_bookmaker: odds?.bookmaker || null,
      odds_error: odds ? null : 'No betting line available',
      // New: All available props with predictions
      props: (() => {
        const propsWithPredictions = {};
        
        // Merge betting lines with predictions
        for (const [propType, propData] of Object.entries(allProps || {})) {
          const prediction = allPredictions[propType];
          propsWithPredictions[propType] = {
            ...propData,
            // Add prediction data if available (including analysis)
            ...(prediction ? {
              prediction: prediction[`predicted_${propType}`] || prediction.predicted_points || null,
              prediction_confidence: prediction.confidence || null,
              prediction_error_margin: prediction.error_margin || null,
              prediction_analysis: prediction.analysis || null,
              prediction_recommendation: prediction.recommendation || null,
              prediction_stats: prediction.stats || null
            } : {})
          };
        }
        
        return propsWithPredictions;
      })(),
      // Store all predictions separately for easy access
      predictions: allPredictions,
      player_image: (() => {
        // Check cache first for image metadata
        const imageMeta = imageMetadataCache.get(finalPlayerName);
        if (imageMeta && imageMeta.hasImage) {
          return imageMeta.imageUrl;
        }
        
        // Check if local image exists
        if (imageExists(finalPlayerName)) {
          const localUrl = getImageUrl(finalPlayerName);
          imageMetadataCache.set(finalPlayerName, localUrl, stats?.player?.nba_id || stats?.player?.id);
          return localUrl;
        }
        
        // Fallback to NBA.com CDN if we have player ID
        const nbaId = stats?.player?.nba_id || stats?.player?.id;
        if (nbaId) {
          const cdnUrl = `https://cdn.nba.com/headshots/nba/latest/260x190/${nbaId}.png`;
          // Cache that we're using CDN (but mark as not local)
          imageMetadataCache.set(finalPlayerName, cdnUrl, nbaId);
          return cdnUrl;
        }
        
        // No image available
        imageMetadataCache.setNoImage(finalPlayerName);
        return null;
      })(),
      // Injury data for both teams - only include if we have actual injuries
      injuries: injuryData && (injuryData.playerTeamInjuries?.length > 0 || injuryData.opponentInjuries?.length > 0) ? {
        player_team: {
          team: injuryData.playerTeamAbbrev,
          injuries: injuryData.playerTeamInjuries.filter(inj => inj.playerName && inj.playerName !== 'Unknown' && inj.status && inj.status !== 'Unknown') || []
        },
        opponent: {
          team: injuryData.opponentAbbrev,
          injuries: injuryData.opponentInjuries.filter(inj => inj.playerName && inj.playerName !== 'Unknown' && inj.status && inj.status !== 'Unknown') || []
        }
      } : {
        player_team: {
          team: teamAbbrev || null,
          injuries: []
        },
        opponent: {
          team: nextGame?.opponent || null,
          injuries: []
        }
      }
    };

    // Only log response structure in development
    if (process.env.NODE_ENV === 'development') {
    console.log('Sending response:', JSON.stringify(response, null, 2));
    }
    res.json(response);
  } catch (error) {
    console.error('Error in compare endpoint:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: error.message || 'Failed to compare prediction and odds',
      player: 'Unknown',
      stats: [],
      prediction: null,
      betting_line: null,
      recommendation: 'N/A'
    });
  }
});

/**
 * GET /api/player/tracking/stats
 * Get prediction accuracy statistics
 */
router.get('/tracking/stats', async (req, res) => {
  try {
    const stats = getAccuracyStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting accuracy stats:', error);
    res.status(500).json({ error: error.message || 'Failed to get accuracy stats' });
  }
});

/**
 * GET /api/player/tracking/pending
 * Get predictions that need evaluation
 */
router.get('/tracking/pending', async (req, res) => {
  try {
    const pending = getPendingEvaluations();
    res.json({ count: pending.length, predictions: pending });
  } catch (error) {
    console.error('Error getting pending evaluations:', error);
    res.status(500).json({ error: error.message || 'Failed to get pending evaluations' });
  }
});

/**
 * POST /api/player/tracking/update
 * Update a prediction with actual outcome
 * Body: { predictionId: string, actualPoints: number }
 */
router.post('/tracking/update', async (req, res) => {
  try {
    const { predictionId, actualPoints } = req.body;
    
    if (!predictionId || actualPoints === undefined || actualPoints === null) {
      return res.status(400).json({ 
        error: 'predictionId and actualPoints are required' 
      });
    }
    
    if (typeof actualPoints !== 'number' || actualPoints < 0) {
      return res.status(400).json({ 
        error: 'actualPoints must be a non-negative number' 
      });
    }
    
    const updated = updatePredictionOutcome(predictionId, actualPoints);
    
    if (!updated) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    
    res.json({
      success: true,
      prediction: updated
    });
  } catch (error) {
    console.error('Error updating prediction outcome:', error);
    res.status(500).json({ error: error.message || 'Failed to update prediction outcome' });
  }
});

/**
 * GET /api/player/tracking/export
 * Export evaluated predictions for XGBoost retraining
 * Query params:
 *   - minAccuracy (optional, default 70)
 */
router.get('/tracking/export', async (req, res) => {
  try {
    const minAccuracy = parseInt(req.query.minAccuracy) || 70;
    const exportData = exportForRetraining(minAccuracy);
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting for retraining:', error);
    res.status(500).json({ error: error.message || 'Failed to export data' });
  }
});

/**
 * POST /api/player/tracking/evaluate
 * Automatically evaluate all pending predictions by fetching actual game results
 * This may take a while as it fetches data from NBA.com for each prediction
 */
router.post('/tracking/evaluate', async (req, res) => {
  try {
    const results = await evaluatePendingPredictions();
    res.json({
      success: true,
      ...results,
      message: `Evaluation complete: ${results.evaluated} evaluated, ${results.failed} failed, ${results.skipped} skipped`
    });
  } catch (error) {
    console.error('Error evaluating predictions:', error);
    res.status(500).json({ error: error.message || 'Failed to evaluate predictions' });
  }
});

/**
 * POST /api/player/tracking/evaluate/:id
 * Evaluate a specific prediction by ID with actual points
 * Body: { actualPoints: number }
 */
router.post('/tracking/evaluate/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { actualPoints } = req.body;
    
    if (actualPoints === undefined || actualPoints === null) {
      return res.status(400).json({ error: 'actualPoints is required' });
    }
    
    if (typeof actualPoints !== 'number' || actualPoints < 0) {
      return res.status(400).json({ error: 'actualPoints must be a non-negative number' });
    }
    
    const result = await evaluatePredictionById(id, actualPoints);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error evaluating prediction:', error);
    res.status(500).json({ error: error.message || 'Failed to evaluate prediction' });
  }
});

/**
 * POST /api/player/resolve-predictions
 * Resolve pending user predictions by checking actual game stats.
 * Body: { predictions: [{ id, playerName, playerId, propType, line, pick, gameDate }] }
 * Returns: { resolved: [{ id, result, actualValue }] }
 */
router.post('/resolve-predictions', async (req, res) => {
  try {
    const { predictions } = req.body;
    if (!Array.isArray(predictions) || predictions.length === 0) {
      return res.json({ resolved: [] });
    }

    // Group predictions by playerName to minimize API calls
    const byPlayer = {};
    for (const pred of predictions) {
      if (!pred.playerName || !pred.propType || !pred.gameDate) continue;
      if (!byPlayer[pred.playerName]) byPlayer[pred.playerName] = [];
      byPlayer[pred.playerName].push(pred);
    }

    const statMap = {
      'points': g => g.pts ?? g.points ?? 0,
      'rebounds': g => g.reb ?? g.rebounds ?? 0,
      'assists': g => g.ast ?? g.assists ?? 0,
      'threes': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
      'threes_made': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
      'steals': g => g.stl ?? g.steals ?? 0,
      'blocks': g => g.blk ?? g.blocks ?? 0,
      'turnovers': g => g.turnovers ?? 0,
      'pra': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
      'points_rebounds_assists': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
      'pr': g => (g.pts ?? 0) + (g.reb ?? 0),
      'points_rebounds': g => (g.pts ?? 0) + (g.reb ?? 0),
      'pa': g => (g.pts ?? 0) + (g.ast ?? 0),
      'points_assists': g => (g.pts ?? 0) + (g.ast ?? 0),
      'ra': g => (g.reb ?? 0) + (g.ast ?? 0),
      'rebounds_assists': g => (g.reb ?? 0) + (g.ast ?? 0),
    };

    const resolved = [];

    for (const [playerName, preds] of Object.entries(byPlayer)) {
      try {
        const stats = await getPlayerStats(playerName);
        if (!stats?.games?.length) continue;

        for (const pred of preds) {
          // Parse the gameDate (format: "Feb 27, 2026") to compare with game log dates ("YYYY-MM-DD")
          const targetDate = new Date(pred.gameDate);
          if (isNaN(targetDate.getTime())) continue;

          const matchingGame = stats.games.find(g => {
            const gd = new Date(g.date);
            return gd.getFullYear() === targetDate.getFullYear() &&
                   gd.getMonth() === targetDate.getMonth() &&
                   gd.getDate() === targetDate.getDate();
          });

          if (!matchingGame) continue;

          const extractor = statMap[pred.propType] || statMap['points'];
          const actualValue = extractor(matchingGame);
          const line = parseFloat(pred.line);

          let result;
          if (actualValue > line) result = pred.pick === 'over' ? 'win' : 'loss';
          else if (actualValue < line) result = pred.pick === 'under' ? 'win' : 'loss';
          else result = 'push';

          resolved.push({ id: pred.id, result, actualValue });
        }
      } catch (err) {
        console.error(`[resolve-predictions] Error fetching stats for ${playerName}:`, err.message);
      }
    }

    res.json({ resolved });
  } catch (error) {
    console.error('Error resolving predictions:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve predictions' });
  }
});

export { router as playerRoutes };
