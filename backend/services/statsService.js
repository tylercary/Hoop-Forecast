/**
 * Stats Service - Clean game logs from NBA.com
 * Normalizes keys and ensures no ESPN references
 */

import { getPlayerGameLog } from './nbaApiService.js';

/**
 * Get normalized player stats from NBA.com
 * Returns game logs with clean, normalized keys
 * @param {string} playerName - Player name
 * @returns {Promise<object>} Stats object with normalized game logs
 */
export async function getPlayerStats(playerName) {
  try {
    if (!playerName) {
      throw new Error('Player name is required');
    }

    console.log(`📊 Fetching stats from NBA.com for: ${playerName}`);

    // Get player ID first (from nbaApiService)
    const { searchPlayer } = await import('./nbaApiService.js');
    const nbaPlayer = await searchPlayer(playerName);
    
    if (!nbaPlayer || !nbaPlayer.id) {
      throw new Error(`Player "${playerName}" not found on NBA.com`);
    }

    console.log(`✅ Found NBA.com player: ${nbaPlayer.name} (ID: ${nbaPlayer.id})`);

    // Get game log with normalized keys
    const games = await getPlayerGameLog(nbaPlayer.id, {
      includePreviousSeason: true,
      currentSeasonGames: 50,
      previousSeasonGames: 50
    });

    if (!games || games.length === 0) {
      throw new Error(`No game data found for ${playerName}`);
    }

    // Games are already normalized by getPlayerGameLog
    // Keys: pts, reb, ast, stl, blk, tpm, minutes, opponent
    // Also includes legacy keys for backward compatibility

    return {
      player: {
        id: nbaPlayer.id,
        name: nbaPlayer.name,
        team: nbaPlayer.team || null
      },
      games: games,
      stats: games  // Alias for backward compatibility
    };
  } catch (error) {
    console.error(`❌ Error fetching stats for ${playerName}:`, error.message);
    throw error;
  }
}

/**
 * Normalize game log keys to standard format
 * This ensures consistent keys across the application
 * @param {Array} games - Raw game log array
 * @returns {Array} Normalized game log array
 */
export function normalizeGameLogKeys(games) {
  if (!Array.isArray(games)) return [];
  
  return games.map(game => {
    // Normalize to standard keys
    return {
      // Standard normalized keys (primary)
      pts: game.pts || game.points || 0,
      reb: game.reb || game.rebounds || 0,
      ast: game.ast || game.assists || 0,
      stl: game.stl || game.steals || 0,
      blk: game.blk || game.blocks || 0,
      tpm: game.tpm || game.threes_made || game.threes || 0,
      minutes: game.minutes || game.min || '0',
      opponent: game.opponent || 'N/A',
      
      // Additional normalized fields
      date: game.date || '',
      home: game.home || false,
      result: game.result || game.wl || '',
      season: game.season || '',
      
      // Legacy keys for backward compatibility
      points: game.pts || game.points || 0,
      rebounds: game.reb || game.rebounds || 0,
      assists: game.ast || game.assists || 0,
      steals: game.stl || game.steals || 0,
      blocks: game.blk || game.blocks || 0,
      threes_made: game.tpm || game.threes_made || game.threes || 0,
      threes: game.tpm || game.threes_made || game.threes || 0,
      min: game.minutes || game.min || '0'
    };
  });
}






