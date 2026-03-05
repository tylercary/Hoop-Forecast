/**
 * Batch Prediction Cron
 * Generates predictions for ALL players with active betting lines.
 * Runs daily so the model accumulates training data from every player,
 * not just the ones users happen to click on.
 */

import axios from 'axios';
import { getPlayerStats } from './nbaApiService.js';
import { predictPropFromGames } from './unifiedPredictionService.js';

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
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

  // Cache game logs per player so we don't re-fetch for each prop type
  const gameLogCache = new Map();
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

      // Generate prediction — this stores it via storePrediction internally
      await predictPropFromGames(
        games,
        entry.name,
        entry.propType,
        entry.nextGame,
        null, // no injury data for batch
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
