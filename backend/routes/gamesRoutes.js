import express from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { mapEspnToNbaAbbrev, getTeamRoster } from '../services/nbaApiService.js';

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

    // Fetch rosters for both teams
    const homeId = home?.team?.id;
    const awayId = away?.team?.id;
    const [homeRoster, awayRoster] = await Promise.all([
      homeId ? getTeamRoster(homeId).catch(() => []) : [],
      awayId ? getTeamRoster(awayId).catch(() => [])  : []
    ]);

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
      rosters: {
        homeTeam: homeRoster,
        awayTeam: awayRoster
      }
    };

    gameDetailCache.set(gameId, game);
    res.json(game);
  } catch (err) {
    console.error('[Games] Game detail fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch game details' });
  }
});

export { router as gamesRoutes };
