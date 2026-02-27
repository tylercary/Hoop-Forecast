import express from 'express';
import { getMatchupInjuries, getTeamInjuries } from '../services/injuryService.js';

const router = express.Router();

/**
 * GET /api/test/injuries/:team
 * Test endpoint to check injury data for a team
 */
router.get('/injuries/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    console.log(`🧪 Testing injury data for ${team}`);
    
    const injuries = await getTeamInjuries(team);
    
    res.json({
      team: team,
      injuryCount: injuries.length,
      injuries: injuries,
      message: injuries.length > 0 
        ? `Found ${injuries.length} injuries for ${team}` 
        : `No injuries found for ${team} - check backend logs for details`
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Check backend console for detailed error logs'
    });
  }
});

/**
 * GET /api/test/matchup-injuries/:team1/:team2
 * Test endpoint to check injury data for a matchup
 */
router.get('/matchup-injuries/:team1/:team2', async (req, res) => {
  try {
    const team1 = req.params.team1.toUpperCase();
    const team2 = req.params.team2.toUpperCase();
    console.log(`🧪 Testing matchup injury data: ${team1} vs ${team2}`);
    
    const injuries = await getMatchupInjuries(team1, team2);
    
    res.json({
      matchup: `${team1} vs ${team2}`,
      team1Injuries: injuries.playerTeamInjuries.length,
      team2Injuries: injuries.opponentInjuries.length,
      data: injuries,
      message: `${team1}: ${injuries.playerTeamInjuries.length} injuries, ${team2}: ${injuries.opponentInjuries.length} injuries`
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Check backend console for detailed error logs'
    });
  }
});

export { router as testInjuryRouter };
