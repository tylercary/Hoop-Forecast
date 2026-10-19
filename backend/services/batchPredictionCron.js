/**
 * Batch Prediction Cron
 * Generates predictions for ALL players with active betting lines.
 * Runs daily so the model accumulates training data from every player,
 * not just the ones users happen to click on.
 */

import axios from 'axios';
import { getPlayerStats, mapEspnToNbaAbbrev } from './nbaApiService.js';
import { predictPropsFromGames } from './unifiedPredictionService.js';
import { getMatchupInjuries } from './injuryService.js';
import { getTeamAbbrevFromFullName } from './teamMappingService.js';
import { predictGameOutcome } from './gameOutcomePredictionService.js';
import { getGameOdds, getGameSpread } from './oddsService.js';
import { summarizeBooks } from './marketFeatureService.js';
import { storeGamePrediction } from './gamePredictionTrackingService.js';
import { getAllEventOdds } from './oddsEventCache.js';

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

  // All events' props for every relevant book, from the shared cache
  const results = await getAllEventOdds();
  const players = [];
  const seen = new Map(); // player|prop -> entry, so every book's line joins the market summary

  for (const { event, data } of results) {
    if (!data?.bookmakers?.length) continue;

    for (const bookmaker of data.bookmakers) {
      for (const market of bookmaker.markets || []) {
        const propType = PROP_TYPE_MAP[market.key];
        if (!propType) continue;

        // One book: { player -> { line, over_odds, under_odds } }
        const byPlayer = new Map();
        for (const outcome of market.outcomes || []) {
          const playerName = outcome.description;
          const line = parseFloat(outcome.point);
          if (!playerName || isNaN(line) || line <= 0) continue;
          const side = (outcome.name || '').toLowerCase();
          const entry = byPlayer.get(playerName) || { line, over_odds: null, under_odds: null };
          if (side === 'over') { entry.line = line; entry.over_odds = outcome.price ?? null; }
          else if (side === 'under' && entry.over_odds == null) { entry.line = line; }
          if (side === 'under' && Math.abs(entry.line - line) < 0.1) entry.under_odds = outcome.price ?? null;
          byPlayer.set(playerName, entry);
        }

        for (const [playerName, book] of byPlayer) {
          const key = `${playerName.toLowerCase()}|${propType}`;
          let entry = seen.get(key);
          if (!entry) {
            // The first book seen sets the line (as before); the rest describe the market
            entry = {
              name: playerName,
              propType,
              line: book.line,
              bookmakerKey: bookmaker.key,
              books: [],
              nextGame: {
                date: event.commence_time?.split('T')[0],
                home_team: event.home_team,
                away_team: event.away_team,
                commence_time: event.commence_time
              }
            };
            seen.set(key, entry);
            players.push(entry);
          }
          entry.books.push({ bookmaker_key: bookmaker.key, line: book.line, over_odds: book.over_odds, under_odds: book.under_odds });
        }
      }
    }
  }

  for (const entry of players) {
    entry.market = summarizeBooks(entry.books, entry.line, entry.bookmakerKey);
    delete entry.books;
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

  // Group the player-prop combos by player: one game-log fetch, one injury
  // lookup and one model process per player instead of one per prop
  const byPlayer = new Map();
  for (const entry of players) {
    if (!byPlayer.has(entry.name)) byPlayer.set(entry.name, []);
    byPlayer.get(entry.name).push(entry);
  }

  const injuryCache = new Map();
  let predicted = 0;
  let failed = 0;

  for (const [name, entries] of byPlayer) {
    try {
      const statsResult = await getPlayerStats(name);
      // Small delay between player API calls
      await new Promise(r => setTimeout(r, 500));

      const games = statsResult?.games;
      if (!games || games.length < 10) {
        failed += entries.length;
        continue;
      }

      const first = entries[0];

      // Resolve team abbreviations from Odds API full names and fetch injuries
      let injuryData = null;
      let gameSpread = null;
      const nextGame = { ...first.nextGame };
      const homeAbbrev = getTeamAbbrevFromFullName(first.nextGame?.home_team);
      const awayAbbrev = getTeamAbbrevFromFullName(first.nextGame?.away_team);

      if (homeAbbrev && awayAbbrev) {
        // The player's team comes from ESPN's player record (game logs carry no team)
        const playerTeam = statsResult?.player?.team || games[0]?.team || games[0]?.teamAbbrev || null;
        const isHome = playerTeam === homeAbbrev;
        const playerTeamAbbrev = isHome ? homeAbbrev : awayAbbrev;
        const opponentAbbrev = isHome ? awayAbbrev : homeAbbrev;
        Object.assign(nextGame, { opponent: opponentAbbrev, isHome, team: playerTeamAbbrev });
        gameSpread = await getGameSpread(first.nextGame.home_team, first.nextGame.away_team);

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

      // One model call for all of this player's props — stores each via storePrediction
      const lines = Object.fromEntries(entries.map(e => [e.propType, e.line]));
      const markets = Object.fromEntries(entries.map(e => [e.propType, e.market || null]));
      const results = await predictPropsFromGames(games, name, lines, nextGame, injuryData, { markets, gameSpread });
      const done = Object.keys(results).length;
      predicted += done;
      failed += entries.length - done;
    } catch (err) {
      failed += entries.length;
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
