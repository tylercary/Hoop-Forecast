import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
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
      if (game?.status === 'in_progress') {
        fetchGame(false);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchGame]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-gray-800 rounded w-20" />
          <div className="h-40 bg-gray-800 rounded-xl" />
          <div className="h-64 bg-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 text-center">
        <p className="text-gray-400">Game not found</p>
      </div>
    );
  }

  const { homeTeam, awayTeam, boxScore, rosters } = game;
  const hasBoxScore = boxScore?.homeTeam?.players?.length > 0 || boxScore?.awayTeam?.players?.length > 0;
  const activeBox = activeTab === 'home' ? boxScore?.homeTeam : boxScore?.awayTeam;
  const activeRoster = activeTab === 'home' ? rosters?.homeTeam : rosters?.awayTeam;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/games')}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Games
      </button>

      {/* Scoreboard */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-gray-800 rounded-xl border p-6 mb-6 ${
          game.status === 'in_progress' ? 'border-red-500/30' : 'border-gray-700'
        }`}
      >
        <div className="text-center mb-5">
          {game.status === 'in_progress' ? (
            <span className="px-3 py-1 rounded-lg text-sm font-bold bg-red-500/20 text-red-400 border border-red-500/30 inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              {game.statusDetail}
            </span>
          ) : game.status === 'final' ? (
            <span className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-700 text-gray-400">FINAL</span>
          ) : (
            <span className="px-3 py-1 rounded-lg text-sm font-bold bg-yellow-500/15 text-yellow-400">
              {new Date(game.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          )}
        </div>

        <div className="flex items-center justify-center gap-6 sm:gap-10">
          <TeamScore team={awayTeam} isFinal={game.status === 'final'} won={parseInt(awayTeam?.score) > parseInt(homeTeam?.score)} showScore={game.status !== 'scheduled'} />
          <span className="text-2xl font-bold text-gray-600">@</span>
          <TeamScore team={homeTeam} isFinal={game.status === 'final'} won={parseInt(homeTeam?.score) > parseInt(awayTeam?.score)} showScore={game.status !== 'scheduled'} />
        </div>

        {game.venue && (
          <p className="text-center text-xs text-gray-500 mt-4">{game.venue}</p>
        )}
      </motion.div>

      {/* Box Score or Rosters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gray-800 rounded-xl border border-gray-700 mb-6 overflow-hidden"
      >
        {/* Team tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('away')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'away' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <img src={getTeamLogo(awayTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
            {awayTeam?.abbreviation}
          </button>
          <button
            onClick={() => setActiveTab('home')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'home' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <img src={getTeamLogo(homeTeam?.abbreviation)} alt="" className="w-5 h-5 object-contain" />
            {homeTeam?.abbreviation}
          </button>
        </div>

        {/* Box score (live/final games) */}
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
                      <td key={col} className="px-2 py-2 text-center text-gray-300 tabular-nums">
                        {player[col] ?? '-'}
                      </td>
                    ))}
                  </tr>
                ))}
                {activeBox.totals && (
                  <tr className="bg-gray-700/30 font-semibold">
                    <td className="px-3 py-2 sticky left-0 bg-gray-700/30 text-white">Totals</td>
                    {STAT_COLS.map(col => (
                      <td key={col} className="px-2 py-2 text-center text-white tabular-nums">
                        {activeBox.totals[col] ?? '-'}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeRoster?.length > 0 ? (
          /* Roster (scheduled games) */
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
                    {player.jersey && (
                      <span className="text-gray-500 text-xs">#{player.jersey}</span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">{player.position}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-gray-500 text-sm">
            No data available yet
          </div>
        )}
      </motion.div>

      {/* Comments */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-gray-800 rounded-xl border border-gray-700 p-5"
      >
        <Comments type="game" targetId={gameId} title="Game Discussion" />
      </motion.div>
    </div>
  );
}

function TeamScore({ team, isFinal, won, showScore }) {
  if (!team) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={getTeamLogo(team.abbreviation)}
        alt={team.abbreviation}
        className="w-14 h-14 sm:w-16 sm:h-16 object-contain"
        onError={(e) => { e.target.style.display = 'none'; }}
      />
      <span className="text-white font-semibold text-sm">{team.displayName || team.abbreviation}</span>
      {showScore && (
        <span className={`text-3xl font-bold tabular-nums ${isFinal && won ? 'text-white' : isFinal ? 'text-gray-500' : 'text-white'}`}>
          {team.score}
        </span>
      )}
      {team.record && <span className="text-xs text-gray-500">{team.record}</span>}
    </div>
  );
}
