import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';

const gamesCache = { data: null, lastFetched: 0, TTL: 30 * 1000 };

export default function Games() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  const fetchGames = useCallback(async (showLoading = false) => {
    const now = Date.now();
    if (gamesCache.data && now - gamesCache.lastFetched < gamesCache.TTL) {
      setGames(gamesCache.data);
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const { data } = await api.get('/games/today');
      gamesCache.data = data;
      gamesCache.lastFetched = Date.now();
      setGames(data);
    } catch (err) {
      console.error('Failed to fetch games:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGames(true);
    const interval = setInterval(() => {
      if (gamesCache.data?.some(g => g.status === 'in_progress')) {
        fetchGames(false);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  const filtered = tab === 'live' ? games.filter(g => g.status === 'in_progress') : games;
  const liveCount = games.filter(g => g.status === 'in_progress').length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-36 bg-slate-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Today's Games</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === 'all'
                ? 'bg-amber-400 text-slate-900'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All Games
          </button>
          <button
            onClick={() => setTab('live')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              tab === 'live'
                ? 'bg-amber-400 text-slate-900'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Live
            {liveCount > 0 && (
              <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
                tab === 'live' ? 'bg-slate-900 text-amber-400' : 'bg-rose-500 text-white'
              }`}>
                {liveCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-400 text-lg">
            {tab === 'live' ? 'No games currently in progress' : 'No NBA games scheduled today'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((game, index) => (
            <GameCard key={game.id} game={game} index={index} onClick={() => navigate(`/games/${game.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({ game, index, onClick }) {
  const statusBadge = () => {
    if (game.status === 'in_progress') {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          LIVE
        </span>
      );
    }
    if (game.status === 'final') {
      return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-slate-700 text-slate-400">FINAL</span>;
    }
    // Scheduled
    const time = new Date(game.startTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-400/15 text-amber-400">{time}</span>;
  };

  const TeamRow = ({ team, isWinner }) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <img
          src={getTeamLogo(team.abbreviation)}
          alt={team.abbreviation}
          className="w-8 h-8 object-contain"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div>
          <span className={`font-semibold text-sm ${isWinner ? 'text-white' : 'text-slate-300'}`}>
            {team.abbreviation}
          </span>
          {team.record && (
            <span className="text-xs text-slate-500 ml-2">{team.record}</span>
          )}
        </div>
      </div>
      {game.status !== 'scheduled' && (
        <span className={`text-xl font-bold tabular-nums ${isWinner ? 'text-white' : 'text-slate-400'}`}>
          {team.score}
        </span>
      )}
    </div>
  );

  const homeScore = parseInt(game.homeTeam?.score) || 0;
  const awayScore = parseInt(game.awayTeam?.score) || 0;
  const isFinal = game.status === 'final';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className={`bg-slate-800 border rounded-lg p-4 cursor-pointer hover:border-slate-600 transition-colors ${
        game.status === 'in_progress' ? 'border-rose-500/30' : 'border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        {statusBadge()}
        {game.broadcasts.length > 0 && (
          <span className="text-xs text-slate-500">{game.broadcasts[0]}</span>
        )}
      </div>

      <div className="space-y-3">
        <TeamRow
          team={game.awayTeam}
          isWinner={isFinal && awayScore > homeScore}
        />
        <TeamRow
          team={game.homeTeam}
          isWinner={isFinal && homeScore > awayScore}
        />
      </div>

      {game.status === 'in_progress' && game.statusDetail && (
        <div className="mt-3 pt-3 border-t border-slate-700/50 text-center">
          <span className="text-xs text-slate-400">{game.statusDetail}</span>
        </div>
      )}
    </motion.div>
  );
}
