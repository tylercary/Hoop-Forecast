import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Tv, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';
import Comments from './Comments';

const STAT_COLS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg', '3pt', 'ft', 'to'];

// Season averages shown for scheduled games (preview)
const PREVIEW_STATS = [
  { key: 'avgPoints', label: 'PPG' },
  { key: 'avgPointsAgainst', label: 'Opp PPG', lowerBetter: true },
  { key: 'fieldGoalPct', label: 'FG%' },
  { key: 'threePointFieldGoalPct', label: '3PT%' },
  { key: 'avgRebounds', label: 'RPG' },
  { key: 'avgAssists', label: 'APG' },
  { key: 'avgSteals', label: 'SPG' },
  { key: 'avgBlocks', label: 'BPG' },
  { key: 'avgTotalTurnovers', label: 'TOPG', lowerBetter: true },
];

// Game stats shown for in-progress/final games
const GAME_STATS = [
  { key: 'fieldGoalPct', label: 'FG%' },
  { key: 'threePointFieldGoalPct', label: '3PT%' },
  { key: 'freeThrowPct', label: 'FT%' },
  { key: 'totalRebounds', label: 'REB' },
  { key: 'assists', label: 'AST' },
  { key: 'steals', label: 'STL' },
  { key: 'blocks', label: 'BLK' },
  { key: 'totalTurnovers', label: 'TO', lowerBetter: true },
  { key: 'pointsInPaint', label: 'Paint PTS' },
  { key: 'fastBreakPoints', label: 'Fast Break' },
  { key: 'fouls', label: 'Fouls', lowerBetter: true },
];

export default function GameDetail() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [boxTab, setBoxTab] = useState('away');

  const fetchGame = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const { data } = await api.get(`/games/${gameId}`);
      setGame(data);
    } catch (err) {
      console.error('Failed to fetch game:', err);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    fetchGame(true);
    const interval = setInterval(() => {
      if (game?.status === 'in_progress') fetchGame(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchGame]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-gray-800 rounded w-20" />
          <div className="h-48 bg-gray-800 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-gray-800 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
        <p className="text-gray-400">Game not found</p>
      </div>
    );
  }

  const { homeTeam, awayTeam, boxScore, teamStats, injuries, predictor, odds, leaders, article } = game;
  const hasBoxScore = boxScore?.homeTeam?.players?.length > 0 || boxScore?.awayTeam?.players?.length > 0;
  const activeBox = boxTab === 'home' ? boxScore?.homeTeam : boxScore?.awayTeam;
  const awayStats = teamStats?.[awayTeam?.abbreviation] || {};
  const homeStats = teamStats?.[homeTeam?.abbreviation] || {};
  const compareStats = game.status === 'scheduled' ? PREVIEW_STATS : GAME_STATS;
  const awayInjuries = injuries?.[awayTeam?.abbreviation] || [];
  const homeInjuries = injuries?.[homeTeam?.abbreviation] || [];
  const hasInjuries = awayInjuries.length > 0 || homeInjuries.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/games')}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Games
      </button>

      {/* Scoreboard Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-gray-800 rounded-lg border p-6 mb-6 ${
          game.status === 'in_progress' ? 'border-red-500/30' : 'border-gray-700'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => navigate(`/team/${awayTeam?.abbreviation}`)}>
            <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">{awayTeam?.displayName}</h2>
              <p className="text-sm text-gray-400">{awayTeam?.record}</p>
              {awayStats['Last Ten Games'] && <p className="text-xs text-gray-500">L10: {awayStats['Last Ten Games'].value}</p>}
            </div>
          </div>

          <div className="text-center px-4 sm:px-8">
            {game.status !== 'scheduled' ? (
              <div className="flex items-center gap-4 sm:gap-6">
                <span className={`text-3xl sm:text-4xl font-bold tabular-nums ${game.status === 'final' && parseInt(awayTeam?.score) > parseInt(homeTeam?.score) ? 'text-white' : game.status === 'final' ? 'text-gray-500' : 'text-white'}`}>
                  {awayTeam?.score}
                </span>
                <span className="text-gray-600 text-lg">-</span>
                <span className={`text-3xl sm:text-4xl font-bold tabular-nums ${game.status === 'final' && parseInt(homeTeam?.score) > parseInt(awayTeam?.score) ? 'text-white' : game.status === 'final' ? 'text-gray-500' : 'text-white'}`}>
                  {homeTeam?.score}
                </span>
              </div>
            ) : (
              <span className="text-2xl font-bold text-yellow-400">
                {new Date(game.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </span>
            )}
            <div className="mt-1">
              {game.status === 'in_progress' ? (
                <span className="text-sm font-semibold text-red-400 flex items-center justify-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  {game.statusDetail}
                </span>
              ) : game.status === 'final' ? (
                <span className="text-sm text-gray-500">Final</span>
              ) : odds ? (
                <span className="text-xs text-gray-500">{odds.details}</span>
              ) : null}
            </div>
            {game.broadcasts?.length > 0 && (
              <div className="flex items-center justify-center gap-1 mt-2 text-xs text-gray-500">
                <Tv className="w-3 h-3" />
                {game.broadcasts.join(', ')}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 flex-1 justify-end cursor-pointer" onClick={() => navigate(`/team/${homeTeam?.abbreviation}`)}>
            <div className="text-right">
              <h2 className="text-lg sm:text-xl font-bold text-white">{homeTeam?.displayName}</h2>
              <p className="text-sm text-gray-400">{homeTeam?.record}</p>
              {homeStats['Last Ten Games'] && <p className="text-xs text-gray-500">L10: {homeStats['Last Ten Games'].value}</p>}
            </div>
            <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
        </div>

        {game.venue && <p className="text-center text-xs text-gray-500 mt-4">{game.venue}</p>}
      </motion.div>

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {predictor && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Matchup Predictor</h3>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-6 h-6 object-contain" />
                <span className="text-white font-bold text-lg">{predictor.awayWinPct}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-lg">{predictor.homeWinPct}%</span>
                <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-6 h-6 object-contain" />
              </div>
            </div>
            <div className="w-full h-3 rounded-full bg-gray-700 overflow-hidden flex">
              <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-l-full" style={{ width: `${predictor.awayWinPct}%` }} />
              <div className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-r-full" style={{ width: `${predictor.homeWinPct}%` }} />
            </div>
            <p className="text-xs text-gray-500 text-center mt-2">Win Probability</p>
          </motion.div>
        )}

        {odds && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Game Odds
              {odds.provider && <span className="text-gray-600 normal-case font-normal ml-1">({odds.provider})</span>}
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="text-left pb-2"></th>
                  <th className="text-center pb-2">Spread</th>
                  <th className="text-center pb-2">O/U</th>
                  <th className="text-center pb-2">ML</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-700/50">
                  <td className="py-2 text-gray-300 font-medium">{awayTeam?.abbreviation}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">{odds.spread > 0 ? `+${(-odds.spread).toFixed(1)}` : `+${Math.abs(odds.spread).toFixed(1)}`}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">o{odds.overUnder}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">{odds.awayMoneyLine > 0 ? `+${odds.awayMoneyLine}` : odds.awayMoneyLine}</td>
                </tr>
                <tr className="border-t border-gray-700/50">
                  <td className="py-2 text-gray-300 font-medium">{homeTeam?.abbreviation}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">{odds.spread < 0 ? odds.spread.toFixed(1) : `+${odds.spread.toFixed(1)}`}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">u{odds.overUnder}</td>
                  <td className="py-2 text-center text-gray-300 tabular-nums">{odds.homeMoneyLine > 0 ? `+${odds.homeMoneyLine}` : odds.homeMoneyLine}</td>
                </tr>
              </tbody>
            </table>
          </motion.div>
        )}

        {article && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Preview</h3>
            <p className="text-white font-semibold text-sm mb-2">{article.headline}</p>
            <p className="text-gray-400 text-xs leading-relaxed line-clamp-4">{article.description}</p>
          </motion.div>
        )}
      </div>

      {/* Team Stats Comparison */}
      {Object.keys(awayStats).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            {game.status === 'scheduled' ? 'Season Averages' : 'Team Stats'}
          </h3>
          <div className="space-y-3">
            {compareStats.map(({ key, label, lowerBetter }) => {
              const awayVal = parseFloat(awayStats[key]?.value) || 0;
              const homeVal = parseFloat(homeStats[key]?.value) || 0;
              const awayBetter = lowerBetter ? awayVal < homeVal : awayVal > homeVal;
              const homeBetter = lowerBetter ? homeVal < awayVal : homeVal > awayVal;
              const total = awayVal + homeVal || 1;

              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-semibold tabular-nums ${awayBetter ? 'text-white' : 'text-gray-500'}`}>
                      {awayStats[key]?.value || '-'}
                    </span>
                    <span className="text-xs text-gray-500">{label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${homeBetter ? 'text-white' : 'text-gray-500'}`}>
                      {homeStats[key]?.value || '-'}
                    </span>
                  </div>
                  <div className="flex gap-1 h-1.5">
                    <div className="flex-1 flex justify-end">
                      <div
                        className={`h-full rounded-l-full ${awayBetter ? 'bg-blue-500' : 'bg-gray-600'}`}
                        style={{ width: `${(awayVal / total) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1">
                      <div
                        className={`h-full rounded-r-full ${homeBetter ? 'bg-red-500' : 'bg-gray-600'}`}
                        style={{ width: `${(homeVal / total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-700/50">
            <div className="flex items-center gap-2">
              <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-4 h-4 object-contain" />
              <span className="text-xs text-gray-400">{awayStats.streak?.value}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{homeStats.streak?.value}</span>
              <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-4 h-4 object-contain" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Team Leaders */}
      {leaders && Object.keys(leaders).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Team Leaders</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { team: awayTeam, data: leaders[awayTeam?.abbreviation] },
              { team: homeTeam, data: leaders[homeTeam?.abbreviation] }
            ].map(({ team, data: teamLeaders }) => (
              teamLeaders && (
                <div key={team?.abbreviation} className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <img src={getTeamLogo(team?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
                    <span className="text-white font-semibold text-sm">{team?.abbreviation}</span>
                  </div>
                  {teamLeaders.map((cat) => (
                    <div
                      key={cat.category}
                      className="flex items-center gap-3 cursor-pointer hover:bg-gray-700/30 rounded-lg p-1.5 -mx-1.5 transition-colors"
                      onClick={() => {
                        if (cat.leader.id) {
                          const slug = encodeURIComponent(cat.leader.name.replace(/\s+/g, '_'));
                          navigate(`/player/${cat.leader.id}/${slug}`);
                        }
                      }}
                    >
                      {cat.leader.headshot ? (
                        <img src={cat.leader.headshot} alt="" className="w-9 h-9 rounded-full object-cover bg-gray-700" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                          {(cat.leader.name || '?')[0]}
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium">{cat.leader.shortName || cat.leader.name}</p>
                        <p className="text-gray-500 text-xs">{cat.category}</p>
                      </div>
                      <span className="text-yellow-400 font-bold text-sm tabular-nums">{cat.leader.value}</span>
                    </div>
                  ))}
                </div>
              )
            ))}
          </div>
        </motion.div>
      )}

      {/* Injuries */}
      {hasInjuries && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            Injuries
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { team: awayTeam, list: awayInjuries },
              { team: homeTeam, list: homeInjuries }
            ].map(({ team, list }) => (
              <div key={team?.abbreviation}>
                <div className="flex items-center gap-2 mb-3">
                  <img src={getTeamLogo(team?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
                  <span className="text-white font-semibold text-sm">{team?.abbreviation}</span>
                </div>
                {list.length > 0 ? (
                  <div className="space-y-2">
                    {list.map((inj, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between cursor-pointer hover:bg-gray-700/30 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
                        onClick={() => {
                          if (inj.id) {
                            const slug = encodeURIComponent(inj.name.replace(/\s+/g, '_'));
                            navigate(`/player/${inj.id}/${slug}`);
                          }
                        }}
                      >
                        <div>
                          <span className="text-white text-sm">{inj.name}</span>
                          {inj.position && <span className="text-gray-500 text-xs ml-1">{inj.position}</span>}
                          {inj.detail && <p className="text-gray-500 text-xs">{inj.detail}</p>}
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          inj.status === 'Out' ? 'bg-red-500/20 text-red-400' :
                          inj.status === 'Day-To-Day' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {inj.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 text-sm">No injuries reported</p>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Box Score (live/final games) */}
      {hasBoxScore && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-gray-800 rounded-lg border border-gray-700 mb-6 overflow-hidden">
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setBoxTab('away')}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                boxTab === 'away' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
              {awayTeam?.abbreviation} Box Score
            </button>
            <button
              onClick={() => setBoxTab('home')}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                boxTab === 'home' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
              {homeTeam?.abbreviation} Box Score
            </button>
          </div>
          {activeBox?.players?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b border-gray-700/50">
                    <th className="text-left px-3 py-2 sticky left-0 bg-gray-800 min-w-[120px]">Player</th>
                    {STAT_COLS.map(col => (
                      <th key={col} className="px-2 py-2 text-center min-w-[40px]">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeBox.players.map((player, i) => (
                    <tr
                      key={player.id || i}
                      className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer transition-colors"
                      onClick={() => {
                        if (player.id) {
                          const slug = encodeURIComponent(player.name.replace(/\s+/g, '_'));
                          navigate(`/player/${player.id}/${slug}`);
                        }
                      }}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-gray-800">
                        <span className="text-white font-medium">{player.shortName || player.name}</span>
                        {player.position && <span className="text-gray-500 text-xs ml-1">{player.position}</span>}
                      </td>
                      {STAT_COLS.map(col => (
                        <td key={col} className="px-2 py-2 text-center text-gray-300 tabular-nums">{player[col] ?? '-'}</td>
                      ))}
                    </tr>
                  ))}
                  {activeBox.totals && (
                    <tr className="bg-gray-700/30 font-semibold">
                      <td className="px-3 py-2 sticky left-0 bg-gray-700/30 text-white">Totals</td>
                      {STAT_COLS.map(col => (
                        <td key={col} className="px-2 py-2 text-center text-white tabular-nums">{activeBox.totals[col] ?? '-'}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Comments */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-gray-800 rounded-lg border border-gray-700 p-5">
        <Comments type="game" targetId={gameId} title="Game Discussion" />
      </motion.div>
    </div>
  );
}
