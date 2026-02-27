import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Medal, TrendingUp, Target, Coins } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getLeaderboard } from '../services/firestoreService';

const SORT_OPTIONS = [
  { key: 'winPct', label: 'Win %' },
  { key: 'wins', label: 'Most Wins' },
  { key: 'total', label: 'Total Picks' },
  { key: 'tokens', label: 'Tokens' },
];

function sortUsers(users, sortBy) {
  return [...users].sort((a, b) => {
    const aRec = a.record || { wins: 0, losses: 0, pushes: 0 };
    const bRec = b.record || { wins: 0, losses: 0, pushes: 0 };
    const aTotal = aRec.wins + aRec.losses;
    const bTotal = bRec.wins + bRec.losses;

    if (sortBy === 'winPct') {
      const aPct = aTotal > 0 ? aRec.wins / aTotal : 0;
      const bPct = bTotal > 0 ? bRec.wins / bTotal : 0;
      if (bPct !== aPct) return bPct - aPct;
      return bRec.wins - aRec.wins;
    }
    if (sortBy === 'wins') {
      if (bRec.wins !== aRec.wins) return bRec.wins - aRec.wins;
      const aPct = aTotal > 0 ? aRec.wins / aTotal : 0;
      const bPct = bTotal > 0 ? bRec.wins / bTotal : 0;
      return bPct - aPct;
    }
    if (sortBy === 'tokens') {
      return (b.tokens || 0) - (a.tokens || 0);
    }
    // total picks (use totalPicks field which includes pending)
    const aPicks = a.totalPicks || (aRec.wins + aRec.losses + aRec.pushes);
    const bPicks = b.totalPicks || (bRec.wins + bRec.losses + bRec.pushes);
    return bPicks - aPicks;
  });
}

function getRankStyle(rank) {
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-gray-300';
  if (rank === 3) return 'text-amber-600';
  return 'text-gray-500';
}

function Leaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('winPct');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await getLeaderboard();
        setUsers(data);
      } catch (err) {
        console.error('[Leaderboard] Error loading:', err);
        setError(err.message || 'Failed to load leaderboard');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const sorted = sortUsers(users, sortBy);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Trophy className="text-yellow-500" size={24} />
        Leaderboard
      </h2>

      {/* Sort Tabs */}
      <div className="flex gap-2">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSortBy(opt.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              sortBy === opt.key
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
          <Trophy className="mx-auto mb-4 text-gray-600" size={48} />
          <h3 className="text-xl font-bold text-white mb-2">No predictions yet</h3>
          <p className="text-gray-400">Be the first to make predictions and claim the top spot!</p>
        </div>
      ) : (
        <>
          {/* Top 3 Podium */}
          {sorted.length >= 3 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-3 gap-3 mb-2"
            >
              {[sorted[1], sorted[0], sorted[2]].map((u, i) => {
                const rank = [2, 1, 3][i];
                const rec = u.record || { wins: 0, losses: 0, pushes: 0 };
                const total = rec.wins + rec.losses;
                const winPct = total > 0 ? ((rec.wins / total) * 100).toFixed(1) : '0.0';
                const isCurrentUser = user?.uid === u.uid;
                return (
                  <motion.div
                    key={u.uid}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.1 }}
                    onClick={() => navigate(`/profile/${u.uid}`)}
                    className={`bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border p-4 text-center cursor-pointer transition-all hover:scale-[1.02] ${
                      rank === 1
                        ? 'border-yellow-500/50 ring-1 ring-yellow-500/20 order-2'
                        : rank === 2
                        ? 'border-gray-600 order-1'
                        : 'border-gray-600 order-3'
                    } ${isCurrentUser ? 'ring-2 ring-yellow-500/40' : ''}`}
                  >
                    <div className={`text-2xl font-bold mb-1 ${getRankStyle(rank)}`}>
                      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                    </div>
                    <div className="w-10 h-10 rounded-full mx-auto mb-2 overflow-hidden">
                      {u.photoURL ? (
                        <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center text-sm font-bold ${
                          isCurrentUser
                            ? 'bg-yellow-500 text-gray-900'
                            : 'bg-gray-700 text-white'
                        }`}>
                          {u.displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                    </div>
                    <p className="text-white font-semibold text-sm truncate">
                      {u.displayName || 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {rec.wins}-{rec.losses}-{rec.pushes}
                    </p>
                    <p className={`text-lg font-bold mt-1 ${
                      parseFloat(winPct) >= 60 ? 'text-green-400' :
                      parseFloat(winPct) >= 50 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {winPct}%
                    </p>
                    {(u.tokens || 0) > 0 && (
                      <div className="flex items-center justify-center gap-1 mt-1">
                        <Coins size={12} className="text-yellow-500" />
                        <span className="text-xs font-bold text-yellow-400">{u.tokens}</span>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* Full Rankings Table */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-700 text-xs text-gray-400 font-semibold uppercase">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Player</div>
              <div className="col-span-2 text-center">Record</div>
              <div className="col-span-2 text-center">Win %</div>
              <div className="col-span-1 text-center">Picks</div>
              <div className="col-span-2 text-center">Tokens</div>
            </div>

            {/* Rows */}
            {sorted.map((u, index) => {
              const rank = index + 1;
              const rec = u.record || { wins: 0, losses: 0, pushes: 0 };
              const total = rec.wins + rec.losses;
              const totalPicks = u.totalPicks || (rec.wins + rec.losses + rec.pushes);
              const winPct = total > 0 ? ((rec.wins / total) * 100).toFixed(1) : '0.0';
              const isCurrentUser = user?.uid === u.uid;

              return (
                <motion.div
                  key={u.uid}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => navigate(`/profile/${u.uid}`)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer transition-colors hover:bg-gray-700/50 ${
                    isCurrentUser
                      ? 'bg-yellow-500/5 border-l-2 border-yellow-500'
                      : 'border-b border-gray-700/50'
                  }`}
                >
                  {/* Rank */}
                  <div className={`col-span-1 font-bold text-sm ${getRankStyle(rank)}`}>
                    {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                  </div>

                  {/* User */}
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden">
                      {u.photoURL ? (
                        <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${
                          isCurrentUser
                            ? 'bg-yellow-500 text-gray-900'
                            : 'bg-gray-700 text-white'
                        }`}>
                          {u.displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                    </div>
                    <span className={`text-sm font-semibold truncate ${
                      isCurrentUser ? 'text-yellow-400' : 'text-white'
                    }`}>
                      {u.displayName || 'Unknown'}
                      {isCurrentUser && <span className="text-xs text-gray-400 ml-1">(you)</span>}
                    </span>
                  </div>

                  {/* Record */}
                  <div className="col-span-2 text-center">
                    <span className="text-sm text-white font-medium">
                      <span className="text-green-400">{rec.wins}</span>
                      <span className="text-gray-500">-</span>
                      <span className="text-red-400">{rec.losses}</span>
                      <span className="text-gray-500">-</span>
                      <span className="text-gray-400">{rec.pushes}</span>
                    </span>
                  </div>

                  {/* Win % */}
                  <div className="col-span-2 text-center">
                    <span className={`text-sm font-bold ${
                      parseFloat(winPct) >= 60 ? 'text-green-400' :
                      parseFloat(winPct) >= 50 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {winPct}%
                    </span>
                  </div>

                  {/* Total Picks */}
                  <div className="col-span-1 text-center text-sm text-gray-400">
                    {totalPicks}
                  </div>

                  {/* Tokens */}
                  <div className="col-span-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Coins size={12} className="text-yellow-500" />
                      <span className="text-sm font-bold text-yellow-400">{u.tokens || 0}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default Leaderboard;
