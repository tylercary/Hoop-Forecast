import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Tv } from 'lucide-react';
import api from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';
import Comments from './Comments';

const STAT_COLS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg', '3pt', 'ft', 'to'];

export default function GameDetail() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('away');

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
          <div className="h-48 bg-gray-800 rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-48 bg-gray-800 rounded-xl" />
            <div className="h-48 bg-gray-800 rounded-xl" />
            <div className="h-48 bg-gray-800 rounded-xl" />
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

  const { homeTeam, awayTeam, boxScore, rosters, predictor, odds, leaders, article } = game;
  const hasBoxScore = boxScore?.homeTeam?.players?.length > 0 || boxScore?.awayTeam?.players?.length > 0;
  const activeBox = activeTab === 'home' ? boxScore?.homeTeam : boxScore?.awayTeam;
  const activeRoster = activeTab === 'home' ? rosters?.homeTeam : rosters?.awayTeam;

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
        className={`bg-gray-800 rounded-xl border p-6 mb-6 ${
          game.status === 'in_progress' ? 'border-red-500/30' : 'border-gray-700'
        }`}
      >
        <div className="flex items-center justify-between">
          {/* Away Team */}
          <div className="flex items-center gap-4 flex-1">
            <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">{awayTeam?.displayName}</h2>
              <p className="text-sm text-gray-400">{awayTeam?.record}</p>
            </div>
          </div>

          {/* Score / Time */}
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

          {/* Home Team */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            <div className="text-right">
              <h2 className="text-lg sm:text-xl font-bold text-white">{homeTeam?.displayName}</h2>
              <p className="text-sm text-gray-400">{homeTeam?.record}</p>
            </div>
            <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
        </div>

        {game.venue && (
          <p className="text-center text-xs text-gray-500 mt-4">{game.venue}</p>
        )}
      </motion.div>

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Matchup Predictor */}
        {predictor && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-5"
          >
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
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-l-full transition-all"
                style={{ width: `${predictor.awayWinPct}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-r-full transition-all"
                style={{ width: `${predictor.homeWinPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center mt-2">Win Probability</p>
          </motion.div>
        )}

        {/* Game Odds */}
        {odds && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-5"
          >
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

        {/* Article Preview */}
        {article && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-5"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Preview</h3>
            <p className="text-white font-semibold text-sm mb-2">{article.headline}</p>
            <p className="text-gray-400 text-xs leading-relaxed line-clamp-4">{article.description}</p>
          </motion.div>
        )}
      </div>

      {/* Team Leaders */}
      {leaders && Object.keys(leaders).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-6"
        >
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

      {/* Box Score / Roster */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="bg-gray-800 rounded-xl border border-gray-700 mb-6 overflow-hidden"
      >
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('away')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'away' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
            {awayTeam?.abbreviation} {hasBoxScore ? 'Box Score' : 'Roster'}
          </button>
          <button
            onClick={() => setActiveTab('home')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'home' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
            {homeTeam?.abbreviation} {hasBoxScore ? 'Box Score' : 'Roster'}
          </button>
        </div>

        {hasBoxScore && activeBox?.players?.length > 0 ? (
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
        ) : activeRoster?.length > 0 ? (
          <div className="divide-y divide-gray-700/30">
            {activeRoster.map((player) => (
              <div
                key={player.id}
                onClick={() => {
                  if (player.id) {
                    const slug = encodeURIComponent(player.displayName.replace(/\s+/g, '_'));
                    navigate(`/player/${player.id}/${slug}`);
                  }
                }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 cursor-pointer transition-colors"
              >
                {player.headshot ? (
                  <img src={player.headshot} alt="" className="w-10 h-10 rounded-full object-cover bg-gray-700" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                    {(player.displayName || '?')[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{player.displayName}</span>
                    {player.jersey && <span className="text-gray-500 text-xs">#{player.jersey}</span>}
                  </div>
                  <span className="text-gray-400 text-xs">{player.position}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-gray-500 text-sm">No data available yet</div>
        )}
      </motion.div>

      {/* Comments */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-gray-800 rounded-xl border border-gray-700 p-5"
      >
        <Comments type="game" targetId={gameId} title="Game Discussion" />
      </motion.div>
    </div>
  );
}
