import express from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { mapEspnToNbaAbbrev } from '../services/nbaApiService.js';
import { getGameOdds } from '../services/oddsService.js';
import { predictGameOutcome } from '../services/gameOutcomePredictionService.js';
import { storeGamePrediction } from '../services/gamePredictionTrackingService.js';

const router = express.Router();

const scoreboardCache = new NodeCache({ stdTTL: 30, useClones: false });
const gameDetailCache = new NodeCache({ stdTTL: 30, useClones: false });

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json'
};

function mapStatus(espnStatus) {
  const name = espnStatus?.type?.name || '';
  if (name === 'STATUS_SCHEDULED') return 'scheduled';
  if (name === 'STATUS_FINAL' || espnStatus?.type?.completed) return 'final';
  if (name === 'STATUS_POSTPONED') return 'postponed';
  return 'in_progress';
}

function formatGame(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const status = competition.status || event.status;
  const competitors = competition.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');

  const formatTeam = (team) => {
    if (!team) return null;
    const abbrev = mapEspnToNbaAbbrev(team.team?.abbreviation);
    return {
      abbreviation: abbrev,
      displayName: team.team?.displayName || '',
      shortName: team.team?.shortDisplayName || '',
      logo: team.team?.logo || '',
      score: team.score || '0',
      record: team.records?.[0]?.summary || '',
      id: team.team?.id || ''
    };
  };

  return {
    id: event.id,
    name: event.name || '',
    shortName: event.shortName || '',
    status: mapStatus(status),
    statusDetail: status?.type?.shortDetail || status?.type?.detail || '',
    period: status?.period || 0,
    clock: status?.displayClock || '',
    startTime: event.date || competition.date || '',
    venue: competition.venue?.fullName || '',
    homeTeam: formatTeam(home),
    awayTeam: formatTeam(away),
    broadcasts: competition.broadcasts?.[0]?.names || []
  };
}

/**
 * GET /api/games/today
 */
router.get('/today', async (req, res) => {
  try {
    const cached = scoreboardCache.get('today');
    if (cached) return res.json(cached);

    const { data } = await axios.get(`${ESPN_BASE}/scoreboard`, {
      headers: ESPN_HEADERS,
      timeout: 10000
    });

    const games = (data.events || [])
      .map(formatGame)
      .filter(Boolean)
      .sort((a, b) => {
        const order = { in_progress: 0, scheduled: 1, final: 2, postponed: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      });

    scoreboardCache.set('today', games);
    res.json(games);
  } catch (err) {
    console.error('[Games] Scoreboard fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

/**
 * GET /api/games/:gameId
 */
router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const cached = gameDetailCache.get(gameId);
    if (cached) return res.json(cached);

    const { data } = await axios.get(`${ESPN_BASE}/summary`, {
      params: { event: gameId },
      headers: ESPN_HEADERS,
      timeout: 10000
    });

    // Base game info from header
    const event = data.header?.competitions?.[0];
    const status = event?.status;
    const competitors = event?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');

    const formatTeamHeader = (team) => {
      if (!team) return null;
      const abbrev = mapEspnToNbaAbbrev(team.team?.abbreviation);
      return {
        abbreviation: abbrev,
        displayName: team.team?.displayName || '',
        shortName: team.team?.shortDisplayName || '',
        logo: team.team?.logo || '',
        score: team.score || '0',
        record: team.record?.[0]?.summary || '',
        id: team.team?.id || ''
      };
    };

    // Parse box score
    const boxScore = { homeTeam: null, awayTeam: null };
    const boxData = data.boxscore?.players || [];

    for (const teamBox of boxData) {
      const teamAbbrev = mapEspnToNbaAbbrev(teamBox.team?.abbreviation);
      const isHome = home?.team?.abbreviation === teamBox.team?.abbreviation;
      const side = isHome ? 'homeTeam' : 'awayTeam';

      const stats = teamBox.statistics?.[0];
      if (!stats) continue;

      const labels = stats.labels || [];
      const players = (stats.athletes || []).map(athlete => {
        const row = {};
        row.name = athlete.athlete?.displayName || '';
        row.shortName = athlete.athlete?.shortDisplayName || '';
        row.id = athlete.athlete?.id || '';
        row.position = athlete.athlete?.position?.abbreviation || '';
        row.starter = athlete.starter || false;

        (athlete.stats || []).forEach((val, i) => {
          const label = (labels[i] || '').toLowerCase();
          row[label] = val;
        });
        return row;
      });

      const totals = {};
      (stats.totals || []).forEach((val, i) => {
        const label = (labels[i] || '').toLowerCase();
        totals[label] = val;
      });

      boxScore[side] = {
        abbreviation: teamAbbrev,
        displayName: teamBox.team?.displayName || '',
        players,
        totals
      };
    }

    // Team stats from boxscore
    const teamStats = {};
    for (const teamBox of data.boxscore?.teams || []) {
      const abbrev = mapEspnToNbaAbbrev(teamBox.team?.abbreviation);
      const stats = {};
      for (const s of teamBox.statistics || []) {
        stats[s.name || s.label] = { value: s.displayValue || '', label: s.label || '' };
      }
      teamStats[abbrev] = stats;
    }

    // Injuries
    const injuries = {};
    for (const teamInj of data.injuries || []) {
      const abbrev = mapEspnToNbaAbbrev(teamInj.team?.abbreviation);
      injuries[abbrev] = (teamInj.injuries || []).map(inj => ({
        name: inj.athlete?.displayName || '',
        id: inj.athlete?.id || '',
        position: inj.athlete?.position?.abbreviation || '',
        status: inj.status || '',
        description: inj.type?.description || '',
        detail: inj.details?.detail || ''
      }));
    }

    // Predictor (win probability)
    const predictor = data.predictor ? {
      homeWinPct: parseFloat(data.predictor.homeTeam?.gameProjection) || 50,
      awayWinPct: parseFloat(data.predictor.awayTeam?.gameProjection) || 50
    } : null;

    // Game odds from pickcenter
    const pick = data.pickcenter?.[0];
    const odds = pick ? {
      provider: pick.provider?.name || '',
      details: pick.details || '',
      spread: pick.spread || 0,
      overUnder: pick.overUnder || 0,
      homeSpreadOdds: pick.homeTeamOdds?.spreadOdds || 0,
      awaySpreadOdds: pick.awayTeamOdds?.spreadOdds || 0,
      homeMoneyLine: pick.homeTeamOdds?.moneyLine || 0,
      awayMoneyLine: pick.awayTeamOdds?.moneyLine || 0
    } : null;

    // Team leaders — summary endpoint has them for live/final games,
    // but for scheduled games the arrays are empty so we fall back to scoreboard data
    const leaders = {};
    for (const teamLeaders of data.leaders || []) {
      const abbrev = mapEspnToNbaAbbrev(teamLeaders.team?.abbreviation);
      const parsed = (teamLeaders.leaders || [])
        .filter(cat => cat.leaders?.length > 0)
        .map(cat => ({
          category: cat.displayName || '',
          leader: {
            name: cat.leaders[0]?.athlete?.displayName || '',
            shortName: cat.leaders[0]?.athlete?.shortDisplayName || '',
            headshot: cat.leaders[0]?.athlete?.headshot?.href || '',
            value: cat.leaders[0]?.displayValue || '',
            id: cat.leaders[0]?.athlete?.id || ''
          }
        }));
      if (parsed.length > 0) leaders[abbrev] = parsed;
    }

    // Fallback: fetch leaders from scoreboard for scheduled games
    if (Object.keys(leaders).length === 0) {
      try {
        const { data: sbData } = await axios.get(`${ESPN_BASE}/scoreboard`, {
          headers: ESPN_HEADERS,
          timeout: 8000
        });
        const sbEvent = (sbData.events || []).find(e => e.id === gameId);
        const sbComp = sbEvent?.competitions?.[0];
        if (sbComp) {
          for (const competitor of sbComp.competitors || []) {
            const abbrev = mapEspnToNbaAbbrev(competitor.team?.abbreviation);
            const parsed = (competitor.leaders || [])
              .filter(cat => cat.leaders?.length > 0)
              .map(cat => ({
                category: cat.displayName || '',
                leader: {
                  name: cat.leaders[0]?.athlete?.displayName || '',
                  shortName: cat.leaders[0]?.athlete?.shortDisplayName || '',
                  headshot: cat.leaders[0]?.athlete?.headshot || '',
                  value: cat.leaders[0]?.displayValue || '',
                  id: cat.leaders[0]?.athlete?.id || ''
                }
              }));
            if (parsed.length > 0) leaders[abbrev] = parsed;
          }
        }
      } catch (e) {
        console.error('[Games] Fallback leaders fetch failed:', e.message);
      }
    }

    // Article preview
    const article = data.article ? {
      headline: data.article.headline || '',
      description: data.article.description || ''
    } : null;

    const game = {
      id: gameId,
      name: data.header?.gameNote || `${away?.team?.displayName || ''} @ ${home?.team?.displayName || ''}`,
      status: mapStatus(status),
      statusDetail: status?.type?.shortDetail || '',
      period: status?.period || 0,
      clock: status?.displayClock || '',
      startTime: event?.date || '',
      venue: data.gameInfo?.venue?.fullName || '',
      homeTeam: formatTeamHeader(home),
      awayTeam: formatTeamHeader(away),
      broadcasts: event?.broadcasts?.[0]?.names || [],
      boxScore,
      teamStats,
      injuries,
      predictor,
      odds,
      leaders,
      article
    };

    gameDetailCache.set(gameId, game);
    res.json(game);
  } catch (err) {
    console.error('[Games] Game detail fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch game details' });
  }
});

/**
 * GET /api/games/:gameId/matchup
 * Matchup analyzer: odds from all sportsbooks + game prediction
 */
router.get('/:gameId/matchup', async (req, res) => {
  try {
    const { gameId } = req.params;

    // First get the game info to know the teams
    const { data } = await axios.get(`${ESPN_BASE}/summary`, {
      params: { event: gameId },
      headers: ESPN_HEADERS,
      timeout: 10000
    });

    const event = data.header?.competitions?.[0];
    const competitors = event?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');

    const homeAbbrev = mapEspnToNbaAbbrev(home?.team?.abbreviation);
    const awayAbbrev = mapEspnToNbaAbbrev(away?.team?.abbreviation);
    const homeFullName = home?.team?.displayName || '';
    const awayFullName = away?.team?.displayName || '';

    // Fetch odds first (sequential so prediction can use Vegas data)
    const odds = await getGameOdds(homeFullName, awayFullName);

    // Then run prediction with Vegas calibration
    const prediction = await predictGameOutcome(homeAbbrev, awayAbbrev, {
      vegasOdds: odds
    });

    // Store prediction for tracking (only for scheduled/upcoming games)
    const gameStatus = event?.status?.type?.name;
    if (prediction && gameStatus === 'STATUS_SCHEDULED') {
      const gameDate = event?.date || '';
      storeGamePrediction(prediction, gameId, homeAbbrev, awayAbbrev, gameDate.split('T')[0]);
    }

    res.json({
      gameId,
      homeTeam: { abbreviation: homeAbbrev, displayName: homeFullName },
      awayTeam: { abbreviation: awayAbbrev, displayName: awayFullName },
      odds,
      prediction
    });
  } catch (err) {
    console.error('[Games] Matchup analyzer failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch matchup data' });
  }
});

export { router as gamesRoutes };
