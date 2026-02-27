import express from 'express';
import { searchPlayersESPN, searchTeamsESPN, getTeamRoster, getTeamRecord, getEspnTeamId } from '../services/nbaApiService.js';

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
      console.log(`🔍 Team search for: "${query}"`);
      const teams = await searchTeamsESPN(query);
      console.log(`✅ Returning ${teams.length} teams`);
      return res.json(teams);
    }

    console.log(`🔍 Search request for: "${query}"`);
    const players = await searchPlayersESPN(query);
    console.log(`✅ Returning ${players.length} players from ESPN`);
    res.json(players);
  } catch (error) {
    console.error('❌ Error in search route:', error);
    console.error('Error stack:', error.stack);
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

    const [roster, record] = await Promise.all([
      getTeamRoster(espnTeamId),
      getTeamRecord(abbreviation),
    ]);

    res.json({ abbreviation: abbreviation.toUpperCase(), espnTeamId, roster, record });
  } catch (error) {
    console.error('❌ Error fetching team:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch team data' });
  }
});

export { router as searchRoutes };

