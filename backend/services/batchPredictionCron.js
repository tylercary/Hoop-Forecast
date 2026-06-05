/**
 * Batch Prediction Cron
 * Generates predictions for ALL players with active betting lines.
 * Runs daily so the model accumulates training data from every player,
 * not just the ones users happen to click on.
 */

import axios from 'axios';
import { getPlayerStats, mapEspnToNbaAbbrev } from './nbaApiService.js';
import { predictPropFromGames } from './unifiedPredictionService.js';
import { getMatchupInjuries } from './injuryService.js';
import { getTeamAbbrevFromFullName } from './teamMappingService.js';
import { predictGameOutcome } from './gameOutcomePredictionService.js';
import { getGameOdds } from './oddsService.js';
import { storeGamePrediction } from './gamePredictionTrackingService.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const PROP_TYPE_MAP = {
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
 * Fetch all players with active betting lines from the Odds API
 */
async function fetchPlayersWithLines() {
  if (!THE_ODDS_API_KEY) {
    console.log('[BatchPred] No Odds API key configured');
    return [];
  }

  // Get all NBA events
  const eventsRes = await axios.get(`${THE_ODDS_API_BASE}/sports/basketball_nba/events`, {
    params: { apiKey: THE_ODDS_API_KEY },
    timeout: 15000
  });

  if (!eventsRes.data?.length) return [];

  const events = eventsRes.data.slice(0, 10);
  const players = [];
  const seen = new Set();

  // Fetch odds for all events in parallel
  const results = await Promise.allSettled(
    events.map(event =>
      axios.get(`${THE_ODDS_API_BASE}/sports/basketball_nba/events/${event.id}/odds`, {
        params: {
          apiKey: THE_ODDS_API_KEY,
          regions: 'us',
          markets: Object.keys(PROP_TYPE_MAP).join(','),
          oddsFormat: 'american'
        },
        timeout: 10000
      }).then(res => ({ event, data: res.data }))
    )
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { event, data } = result.value;
    if (!data?.bookmakers?.length) continue;

    for (const bookmaker of data.bookmakers) {
      for (const market of bookmaker.markets || []) {
        const propType = PROP_TYPE_MAP[market.key];
        if (!propType) continue;

        for (const outcome of market.outcomes || []) {
          const playerName = outcome.description;
          if (!playerName) continue;

          const key = `${playerName.toLowerCase()}|${propType}`;
          if (seen.has(key)) continue;

          const line = parseFloat(outcome.point);
          if (isNaN(line) || line <= 0) continue;

          seen.add(key);
          players.push({
            name: playerName,
            propType,
            line,
            nextGame: {
              date: event.commence_time?.split('T')[0],
              home_team: event.home_team,
              away_team: event.away_team,
              commence_time: event.commence_time
            }
          });
        }
      }
    }
  }

  return players;
}

/**
 * Run batch predictions for all players with active lines.
 * Processes sequentially with delays to avoid API throttling.
 */
export async function runBatchPredictions() {
  console.log('[BatchPred] Starting batch prediction run...');
  const startTime = Date.now();

  let players;
  try {
    players = await fetchPlayersWithLines();
  } catch (err) {
    console.error('[BatchPred] Failed to fetch players with lines:', err.message);
    return;
  }

  if (!players.length) {
    console.log('[BatchPred] No players with active lines found');
    return;
  }

  // Dedupe by player name to minimize API calls for game logs
  const uniquePlayerNames = [...new Set(players.map(p => p.name))];
  console.log(`[BatchPred] Found ${players.length} player-prop combos across ${uniquePlayerNames.length} players`);

  // Cache game logs and injury data to avoid re-fetching per prop type
  const gameLogCache = new Map();
  const injuryCache = new Map();
  let predicted = 0;
  let failed = 0;

  for (const entry of players) {
    try {
      // Fetch game logs (cached per player)
      let statsResult = gameLogCache.get(entry.name);
      if (!statsResult) {
        statsResult = await getPlayerStats(entry.name);
        gameLogCache.set(entry.name, statsResult);
        // Small delay between different player API calls
        await new Promise(r => setTimeout(r, 500));
      }

      const games = statsResult?.games;
      if (!games || games.length < 10) {
        failed++;
        continue;
      }

      // Resolve team abbreviations from Odds API full names and fetch injuries
      let injuryData = null;
      const homeAbbrev = getTeamAbbrevFromFullName(entry.nextGame?.home_team);
      const awayAbbrev = getTeamAbbrevFromFullName(entry.nextGame?.away_team);

      if (homeAbbrev && awayAbbrev) {
        // Determine player's team from their most recent game
        const playerTeam = games[0]?.team || games[0]?.teamAbbrev || null;
        const isHome = playerTeam === homeAbbrev;
        const playerTeamAbbrev = isHome ? homeAbbrev : awayAbbrev;
        const opponentAbbrev = isHome ? awayAbbrev : homeAbbrev;

        // Cache injuries per matchup (both teams share the same injury report)
        const matchupKey = [playerTeamAbbrev, opponentAbbrev].sort().join('|');
        if (!injuryCache.has(matchupKey)) {
          try {
            const injuries = await getMatchupInjuries(playerTeamAbbrev, opponentAbbrev);
            injuryCache.set(matchupKey, injuries);
          } catch {
            injuryCache.set(matchupKey, null);
          }
        }

        const cachedInjuries = injuryCache.get(matchupKey);
        if (cachedInjuries) {
          // Ensure correct orientation: playerTeam injuries vs opponent injuries
          const sortedKey = [playerTeamAbbrev, opponentAbbrev].sort();
          const isReversed = sortedKey[0] !== playerTeamAbbrev;
          injuryData = isReversed
            ? { playerTeamInjuries: cachedInjuries.opponentInjuries, opponentInjuries: cachedInjuries.playerTeamInjuries }
            : cachedInjuries;
        }
      }

      // Generate prediction — this stores it via storePrediction internally
      await predictPropFromGames(
        games,
        entry.name,
        entry.propType,
        entry.nextGame,
        injuryData,
        entry.line
      );

      predicted++;
    } catch (err) {
      failed++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[BatchPred] Complete: ${predicted} predicted, ${failed} failed, ${elapsed}s elapsed`);
}

/**
 * Generate game-level predictions for every scheduled game today so the
 * game prediction tracker accumulates data automatically, not just when
 * a user opens the matchup analyzer.
 */
export async function runBatchGamePredictions() {
  console.log('[BatchGamePred] Starting game prediction batch...');
  const startTime = Date.now();

  let events;
  try {
    const { data } = await axios.get(`${ESPN_BASE}/scoreboard`, { timeout: 10000 });
    events = (data.events || []).filter(e => {
      const status = e.competitions?.[0]?.status?.type?.name;
      return status === 'STATUS_SCHEDULED' || status === 'STATUS_PRE_GAME';
    });
  } catch (err) {
    console.error('[BatchGamePred] Failed to fetch scoreboard:', err.message);
    return;
  }

  if (events.length === 0) {
    console.log('[BatchGamePred] No scheduled games found');
    return;
  }

  let stored = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const comp = event.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const homeAbbrev = mapEspnToNbaAbbrev(home?.team?.abbreviation);
      const awayAbbrev = mapEspnToNbaAbbrev(away?.team?.abbreviation);
      const homeFullName = home?.team?.displayName || '';
      const awayFullName = away?.team?.displayName || '';

      // Get odds and run prediction (sequential so Vegas data informs prediction)
      const odds = await getGameOdds(homeFullName, awayFullName);
      const prediction = await predictGameOutcome(homeAbbrev, awayAbbrev, { vegasOdds: odds });

      if (prediction) {
        const gameDate = (event.date || '').split('T')[0];
        storeGamePrediction(prediction, event.id, homeAbbrev, awayAbbrev, gameDate);
        stored++;
      }

      // Throttle to avoid hammering ESPN/Odds API
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      failed++;
      console.error(`[BatchGamePred] Failed for ${event.id}: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[BatchGamePred] Complete: ${stored} stored, ${failed} failed, ${elapsed}s elapsed`);
}
