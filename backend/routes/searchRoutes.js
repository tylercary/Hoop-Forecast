import express from 'express';
import { searchPlayersESPN, searchTeamsESPN, getTeamRoster, getTeamRecord, getEspnTeamId, getTeamInfo, getTeamStats, getTeamSchedule, getTeamNews } from '../services/nbaApiService.js';

const router = express.Router();

/**
 * GET /api/search?q=query&type=players|teams
 * Search for players or teams by name using ESPN API
 */
router.get('/', async (req, res) => {
  try {
    const query = req.query.q;
    const type = req.query.type || 'players';

    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (type === 'teams') {
      const teams = await searchTeamsESPN(query);
      return res.json(teams);
    }

    const players = await searchPlayersESPN(query);
    res.json(players);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to search',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/search/team/:abbreviation
 * Get team info + full roster
 */
router.get('/team/:abbreviation', async (req, res) => {
  try {
    const { abbreviation } = req.params;
    const espnTeamId = getEspnTeamId(abbreviation);
    if (!espnTeamId) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const [roster, record, info, stats, schedule, news] = await Promise.all([
      getTeamRoster(espnTeamId),
      getTeamRecord(abbreviation),
      getTeamInfo(espnTeamId),
      getTeamStats(espnTeamId),
      getTeamSchedule(espnTeamId),
      getTeamNews(espnTeamId),
    ]);

    // Extract injuries from roster data
    const injuries = roster
      .filter(p => p.injuries && p.injuries.length > 0)
      .map(p => ({ name: p.displayName, id: p.id, position: p.position, status: p.injuries[0].status, headshot: p.headshot }));

    res.json({ abbreviation: abbreviation.toUpperCase(), espnTeamId, roster, record, ...info, stats, schedule, injuries, news });
  } catch (error) {
    console.error('❌ Error fetching team:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch team data' });
  }
});

export { router as searchRoutes };

