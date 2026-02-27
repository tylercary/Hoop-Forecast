import { useState } from 'react';
import { motion } from 'framer-motion';

function GameLogTable({ stats, selectedProp, prediction, bettingLine, nextGameOpponent }) {
  const [seasonFilter, setSeasonFilter] = useState('2025 Season');

  if (!stats || stats.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
      >
        <h3 className="text-xl font-bold text-white mb-4">Player Game Log</h3>
        <p className="text-gray-400 text-center py-8">No game data available</p>
      </motion.div>
    );
  }

  // Get the line to use - for combined props, we need to get it from props
  // For now, only points has prediction, combined props would need their own lines
  const line = bettingLine || (selectedProp === 'points' ? prediction : null);

  // Sort stats: most recent first
  const sortedStats = [...stats].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB - dateA;
  });

  // Filter by season or H2H - use season field if available, otherwise use date
  let filteredStats = sortedStats;
  if (seasonFilter === 'H2H') {
    // Filter to only show games against the next opponent (ALL historical games, no season filter)
    if (nextGameOpponent) {
      filteredStats = sortedStats.filter(game => {
        if (!game.opponent) return false;
        
        // Normalize opponent names for comparison (handle various formats)
        const normalizeOpponent = (opp) => {
          if (!opp) return '';
          // Remove @ symbol if present, convert to uppercase, trim
          // Also handle cases where opponent might be stored as "LAL" or "@LAL" or "LAL 123-456"
          let normalized = opp.toString().replace(/^@/, '').toUpperCase().trim();
          // Extract just the team abbreviation (first 2-3 characters, usually 3)
          // This handles cases like "LAL 123-456" -> "LAL"
          const match = normalized.match(/^([A-Z]{2,3})\b/);
          if (match) {
            normalized = match[1];
          }
          return normalized;
        };
        const gameOpponent = normalizeOpponent(game.opponent);
        const nextOpponent = normalizeOpponent(nextGameOpponent);
        
        // Debug logging for first few matches
        if (filteredStats.length < 3 && gameOpponent === nextOpponent) {
          console.log(`✅ H2H Match: "${game.opponent}" (normalized: "${gameOpponent}") matches "${nextGameOpponent}" (normalized: "${nextOpponent}")`);
        }
        
        return gameOpponent === nextOpponent;
      });
      // Sort by date (most recent first) for H2H
      filteredStats = filteredStats.sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA;
      });
    } else {
      // If no next opponent, show no games for H2H
      filteredStats = [];
    }
  } else if (seasonFilter === '2025 Season') {
    filteredStats = sortedStats.filter(game => {
      // First try to use the season field if available
      if (game.season) {
        // 2025 Season = 2025-26 season (current season)
        return game.season === '2025-26' || game.season.includes('2025-26');
      }
      // Fallback to date parsing - games from 2025 calendar year
      try {
        const date = new Date(game.date);
        return date.getFullYear() === 2025;
      } catch {
        return true;
      }
    });
  } else if (seasonFilter === '2024 Season') {
    filteredStats = sortedStats.filter(game => {
      // First try to use the season field if available
      if (game.season) {
        // 2024 Season = 2024-25 season (previous season)
        return game.season === '2024-25' || game.season.includes('2024-25');
      }
      // Fallback to date parsing - games from 2024 calendar year
      try {
        const date = new Date(game.date);
        return date.getFullYear() === 2024;
      } catch {
        return true;
      }
    });
  }

  const getPropValue = (game) => {
    if (selectedProp === 'points') {
      return game.points || 0;
    } else if (selectedProp === 'assists') {
      return game.assists || 0;
    } else if (selectedProp === 'rebounds') {
      return game.rebounds || 0;
    } else if (selectedProp === 'threes' || selectedProp === 'threes_made') {
      return game.threes_made || game.threes || 0;
    } else if (selectedProp === 'steals') {
      return game.steals || 0;
    } else if (selectedProp === 'blocks') {
      return game.blocks || 0;
    } else if (selectedProp === 'turnovers') {
      return game.turnovers || 0;
    } else if (selectedProp === 'pr' || selectedProp === 'points_rebounds') {
      // Combined: Points + Rebounds
      return (game.points || 0) + (game.rebounds || 0);
    } else if (selectedProp === 'pa' || selectedProp === 'points_assists') {
      // Combined: Points + Assists
      return (game.points || 0) + (game.assists || 0);
    } else if (selectedProp === 'ra' || selectedProp === 'rebounds_assists') {
      // Combined: Rebounds + Assists
      return (game.rebounds || 0) + (game.assists || 0);
    } else if (selectedProp === 'pra' || selectedProp === 'points_rebounds_assists') {
      // Combined: Points + Rebounds + Assists
      return (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
    }
    return game.points || 0;
  };

  const getOverUnder = (game, gameLine) => {
    if (!gameLine) return null;
    const value = getPropValue(game);
    const lineValue = parseFloat(gameLine);

    if (isNaN(lineValue)) return null;

    if (value >= lineValue) {
      return { status: 'O', bgColor: 'bg-green-600', textColor: 'text-white' };
    } else {
      return { status: 'U', bgColor: 'bg-red-600', textColor: 'text-white' };
    }
  };

  // Calculate over/under record
  const overUnderRecord = filteredStats.reduce((acc, game) => {
    const gameLine = game.betting_line || game.line || line;
    const ou = getOverUnder(game, gameLine);
    if (ou) {
      if (ou.status === 'O') acc.over++;
      else acc.under++;
    }
    return acc;
  }, { over: 0, under: 0 });

  // Calculate averages
  const calculateAverages = () => {
    if (filteredStats.length === 0) return null;
    
    const totals = filteredStats.reduce((acc, game) => {
      acc.minutes += parseFloat(game.minutes) || 0;
      acc.points += parseFloat(game.points) || 0;
      acc.rebounds += parseFloat(game.rebounds) || 0;
      acc.assists += parseFloat(game.assists) || 0;
      acc.threes += parseFloat(game.threes_made || game.threes) || 0;
      acc.steals += parseFloat(game.steals) || 0;
      acc.blocks += parseFloat(game.blocks) || 0;
      acc.fgm += parseFloat(game.field_goals_made || game.fgm) || 0;
      acc.fga += parseFloat(game.field_goals_attempted || game.fga) || 0;
      acc.ftm += parseFloat(game.free_throws_made || game.ftm) || 0;
      acc.fta += parseFloat(game.free_throws_attempted || game.fta) || 0;
      acc.tpm += parseFloat(game.three_pointers_made || game.threes_made || game.tpm) || 0;
      acc.tpa += parseFloat(game.three_pointers_attempted || game.threes_attempted || game.tpa) || 0;
      acc.propValue += getPropValue(game);
      return acc;
    }, { minutes: 0, points: 0, rebounds: 0, assists: 0, threes: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, tpa: 0, propValue: 0 });

    const count = filteredStats.length;
    return {
      minutes: (totals.minutes / count).toFixed(1),
      points: (totals.points / count).toFixed(1),
      rebounds: (totals.rebounds / count).toFixed(1),
      assists: (totals.assists / count).toFixed(1),
      threes: (totals.threes / count).toFixed(1),
      steals: (totals.steals / count).toFixed(1),
      blocks: (totals.blocks / count).toFixed(1),
      fgPct: totals.fga > 0 ? ((totals.fgm / totals.fga) * 100).toFixed(0) : 0,
      ftPct: totals.fta > 0 ? ((totals.ftm / totals.fta) * 100).toFixed(0) : 0,
      tpPct: totals.tpa > 0 ? ((totals.tpm / totals.tpa) * 100).toFixed(0) : 0,
      propValue: (totals.propValue / count).toFixed(1),
      propLine: line ? parseFloat(line).toFixed(1) : 'N/A'
    };
  };

  const averages = calculateAverages();

  const formatDate = (dateStr) => {
    try {
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      }
    } catch (e) {}
    return dateStr || 'N/A';
  };

  const formatScore = (game) => {
    const result =
      game?.result ||
      game?.win_loss ||
      game?.wl ||
      game?.game_result ||
      null;
    
    if (result) {
      return result; // e.g., "W" or "L" (NBA API only provides win/loss flag)
    }
    
    // Fallback: show matchup context instead of N/A
    if (typeof game.home === 'boolean' && game.opponent) {
      return `${game.home ? 'vs' : '@'} ${game.opponent}`;
    }
    
    return 'N/A';
  };


  // Show empty state for H2H if no games found
  if (seasonFilter === 'H2H' && nextGameOpponent && filteredStats.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white mb-1">
              Head-to-Head vs {nextGameOpponent}
            </h3>
          </div>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg mb-2">
            No previous games found against {nextGameOpponent}
          </p>
          <p className="text-gray-500 text-sm">
            This player has never played against this team in their career.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      key={selectedProp}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-white mb-2">
            {seasonFilter === 'H2H' && nextGameOpponent
              ? `Head-to-Head vs ${nextGameOpponent}`
              : 'Player Game Log'}
          </h3>
          <div className="flex items-center gap-4">
            <p className="text-sm text-gray-400">
              <span className="text-white font-semibold">{filteredStats.length}</span> games displayed
            </p>
            {overUnderRecord.over + overUnderRecord.under > 0 && line && (
              <div className="text-sm">
                <p className="text-gray-400">
                  Over/Under: <span className="text-green-400 font-semibold">{overUnderRecord.over}W</span> - <span className="text-red-400 font-semibold">{overUnderRecord.under}L</span>
                  {' '}({((overUnderRecord.over / (overUnderRecord.over + overUnderRecord.under)) * 100).toFixed(0)}%)
                </p>
                <p className="text-gray-500 text-xs mt-0.5">
                  Based on current line: {parseFloat(line).toFixed(1)}
                </p>
              </div>
            )}
          </div>
        </div>
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-yellow-500"
        >
          <option>2025 Season</option>
          <option>2024 Season</option>
          {nextGameOpponent && <option>H2H</option>}
        </select>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-700/20">
              <th className="text-left py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">Date</th>
              <th className="text-left py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">Matchup</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">Result</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">MIN</th>
              <th className="text-center py-3 px-4 text-yellow-400 font-bold uppercase text-xs tracking-wider bg-yellow-500/10">
                {selectedProp === 'pr' || selectedProp === 'points_rebounds' ? 'PTS+REB' :
                 selectedProp === 'pa' || selectedProp === 'points_assists' ? 'PTS+AST' :
                 selectedProp === 'ra' || selectedProp === 'rebounds_assists' ? 'REB+AST' :
                 selectedProp === 'pra' || selectedProp === 'points_rebounds_assists' ? 'PTS+REB+AST' :
                 selectedProp === 'threes' || selectedProp === 'threes_made' ? '3PM' :
                 selectedProp === 'steals' ? 'STL' :
                 selectedProp === 'blocks' ? 'BLK' :
                 selectedProp === 'turnovers' ? 'TO' :
                 selectedProp === 'assists' ? 'AST' :
                 selectedProp === 'rebounds' ? 'REB' :
                 'PTS'}
              </th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">REB</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">AST</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">3PM</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">STL</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">BLK</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">FG%</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">FT%</th>
              <th className="text-center py-3 px-4 text-gray-300 font-bold uppercase text-xs tracking-wider">3P%</th>
            </tr>
          </thead>
          <tbody>
            {filteredStats.slice(0, 20).map((game, idx) => {
              // Get betting line for this specific game (use game's line if available, otherwise use current line)
              const gameLine = game.betting_line || game.line || line;
              const ou = getOverUnder(game, gameLine);
              const propValue = getPropValue(game);
              const fgm = game.field_goals_made || game.fgm || 0;
              const fga = game.field_goals_attempted || game.fga || 0;
              const fgPct = fga > 0 ? ((fgm / fga) * 100).toFixed(0) : 0;
              const ftm = game.free_throws_made || game.ftm || 0;
              const fta = game.free_throws_attempted || game.fta || 0;
              const ftPct = fta > 0 ? ((ftm / fta) * 100).toFixed(0) : 0;
              const tpm = game.three_pointers_made || game.threes_made || game.tpm || 0;
              const tpa = game.three_pointers_attempted || game.threes_attempted || game.tpa || 0;
              const tpPct = tpa > 0 ? ((tpm / tpa) * 100).toFixed(0) : 0;

              const isAway = game.home === false;
              const opponentLabel = isAway ? `@${game.opponent}` : game.opponent;
              
              return (
                <motion.tr
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.01, duration: 0.15 }}
                  whileHover={{ backgroundColor: 'rgba(55, 65, 81, 0.5)' }}
                  className="border-b border-gray-700/50 transition-colors"
                >
                  <td className="py-3 px-4 text-gray-300 font-medium">{formatDate(game.date)}</td>
                  <td className="py-3 px-4 text-white font-medium">{opponentLabel || 'N/A'}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${
                      formatScore(game) === 'W' ? 'bg-green-500/20 text-green-400' :
                      formatScore(game) === 'L' ? 'bg-red-500/20 text-red-400' :
                      'text-gray-400'
                    }`}>
                      {formatScore(game)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center text-gray-300 font-medium">{game.minutes || 0}</td>
                  <td className="py-3 px-4 text-center bg-yellow-500/10">
                    <div className="flex items-center justify-center gap-2">
                      <span className="font-bold text-lg text-white">{propValue}</span>
                      {line && ou && (
                        <span className={`${ou.bgColor} ${ou.textColor} px-2 py-0.5 rounded font-bold text-xs`}>
                          {ou.status}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center text-gray-300">{game.rebounds || 0}</td>
                  <td className="py-3 px-4 text-center text-gray-300">{game.assists || 0}</td>
                  <td className="py-3 px-4 text-center text-gray-300">{game.threes_made || game.threes || 0}</td>
                  <td className="py-3 px-4 text-center text-gray-300">{game.steals || 0}</td>
                  <td className="py-3 px-4 text-center text-gray-300">{game.blocks || 0}</td>
                  <td className="py-3 px-4 text-center text-gray-400 text-xs">{fgm}-{fga} ({fgPct}%)</td>
                  <td className="py-3 px-4 text-center text-gray-400 text-xs">{ftm}-{fta} ({ftPct}%)</td>
                  <td className="py-3 px-4 text-center text-gray-400 text-xs">{tpm}-{tpa} ({tpPct}%)</td>
                </motion.tr>
              );
            })}
            {/* Averages Row */}
            {averages && (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="border-t-2 border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-transparent"
              >
                <td className="py-4 px-4 text-yellow-400 font-bold uppercase text-sm">Season Avg</td>
                <td className="py-4 px-4"></td>
                <td className="py-4 px-4"></td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.minutes}</td>
                <td className="py-4 px-4 text-center text-yellow-400 font-bold text-lg bg-yellow-500/20">{averages.propValue}</td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.rebounds}</td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.assists}</td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.threes}</td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.steals}</td>
                <td className="py-4 px-4 text-center text-white font-semibold">{averages.blocks}</td>
                <td className="py-4 px-4 text-center text-gray-300 text-xs font-semibold">{averages.fgPct}%</td>
                <td className="py-4 px-4 text-center text-gray-300 text-xs font-semibold">{averages.ftPct}%</td>
                <td className="py-4 px-4 text-center text-gray-300 text-xs font-semibold">{averages.tpPct}%</td>
              </motion.tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

export default GameLogTable;
