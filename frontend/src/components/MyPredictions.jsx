import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Target, Trophy, TrendingUp, Clock, RefreshCw, Coins } from 'lucide-react';
import { resolveImageUrl } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { getUserPredictions, getUserRecord, resolvePendingPredictions, syncUserRecord, deletePrediction } from '../services/firestoreService';

const PROP_LABELS = {
  points: 'Pts',
  assists: 'Ast',
  rebounds: 'Reb',
  threes: '3PM',
  threes_made: '3PM',
  steals: 'Stl',
  blocks: 'Blk',
  turnovers: 'TO',
  pra: 'PRA',
  pr: 'P+R',
  pa: 'P+A',
  ra: 'R+A',
  points_rebounds: 'P+R',
  points_assists: 'P+A',
  rebounds_assists: 'R+A',
  points_rebounds_assists: 'PRA',
};

function MyPredictions() {
  const { user, tokens, addTokens, predictionsResolved } = useAuth();
  const navigate = useNavigate();
  const [predictions, setPredictions] = useState([]);
  const [record, setRecord] = useState({ wins: 0, losses: 0, pushes: 0 });
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null); // prediction id being acted on

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [preds, rec] = await Promise.all([
          getUserPredictions(user.uid),
          getUserRecord(user.uid),
        ]);
        setPredictions(preds);
        setRecord(rec);

        // Sync record from actual predictions (fixes any stale/duplicated counts)
        const correctRecord = {
          wins: preds.filter((p) => p.result === 'win').length,
          losses: preds.filter((p) => p.result === 'loss').length,
          pushes: preds.filter((p) => p.result === 'push').length,
        };
        const correctTotal = correctRecord.wins + correctRecord.losses + correctRecord.pushes;
        const storedTotal = rec.wins + rec.losses + rec.pushes;
        if (correctTotal !== storedTotal || correctRecord.wins !== rec.wins || correctRecord.losses !== rec.losses) {
          syncUserRecord(user.uid, preds).catch(() => {});
        }

        // Auto-resolve pending predictions (skip if AuthContext already resolved on login)
        const hasPending = preds.some((p) => !p.result);
        if (hasPending && !predictionsResolved) {
          setResolving(true);
          try {
            const { resolved, updates, totalTokenChange } = await resolvePendingPredictions(user.uid, preds);
            if (resolved > 0) {
              if (totalTokenChange > 0) addTokens(totalTokenChange);
              // Reload fresh data after resolving
              const [freshPreds, freshRec] = await Promise.all([
                getUserPredictions(user.uid),
                getUserRecord(user.uid),
              ]);
              setPredictions(freshPreds);
              setRecord(freshRec);
            }
          } catch (resolveErr) {
            console.error('[MyPredictions] Error resolving predictions:', resolveErr);
          } finally {
            setResolving(false);
          }
        }
      } catch (err) {
        console.error('[MyPredictions] Error loading predictions:', err);
        setError(err.message || 'Failed to load predictions. Check Firestore rules.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  if (!user) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <Target className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">Sign in to see your predictions</h3>
        <p className="text-gray-400">Make predictions on player props and track your record.</p>
      </div>
    );
  }

  // Always derive record from actual predictions (single source of truth)
  const displayWins = predictions.filter((p) => p.result === 'win').length;
  const displayLosses = predictions.filter((p) => p.result === 'loss').length;
  const displayPushes = predictions.filter((p) => p.result === 'push').length;
  const displayTotal = displayWins + displayLosses + displayPushes;
  const displayWinPct = displayTotal > 0 ? ((displayWins / (displayWins + displayLosses || 1)) * 100).toFixed(1) : '0.0';

  const filteredPredictions = predictions.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !p.result;
    if (filter === 'wins') return p.result === 'win';
    if (filter === 'losses') return p.result === 'loss';
    return true;
  });

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
  ];

  const canEdit = (pred) => {
    if (pred.result) return false; // Already resolved
    const ct = pred.commenceTime;
    if (!ct) return true; // No commence time stored, allow edit
    const gameStart = new Date(ct).getTime();
    return Date.now() < gameStart - 5 * 60 * 1000; // 5 min before
  };

  const handleDelete = async (pred, e) => {
    e.stopPropagation();
    if (actionLoading) return;
    setActionLoading(pred.id);
    try {
      await deletePrediction(pred.id);
      if (pred.wager > 0) addTokens(pred.wager);
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    } catch (err) {
      console.error('Error deleting prediction:', err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Target className="text-yellow-500" size={24} />
          My Predictions
        </h2>
        {resolving && (
          <span className="text-xs text-yellow-400 animate-pulse">Checking game results...</span>
        )}
      </div>

      {/* Record Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-5 gap-3"
      >
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700 text-center">
          <Trophy className="mx-auto mb-1 text-yellow-500" size={20} />
          <p className="text-2xl font-bold text-white">{displayWins}-{displayLosses}-{displayPushes}</p>
          <p className="text-xs text-gray-400">Record</p>
        </div>
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700 text-center">
          <TrendingUp className="mx-auto mb-1 text-green-400" size={20} />
          <p className="text-2xl font-bold text-white">{displayWinPct}%</p>
          <p className="text-xs text-gray-400">Win Rate</p>
        </div>
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700 text-center">
          <Target className="mx-auto mb-1 text-blue-400" size={20} />
          <p className="text-2xl font-bold text-white">{predictions.length}</p>
          <p className="text-xs text-gray-400">Total Picks</p>
        </div>
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700 text-center">
          <Clock className="mx-auto mb-1 text-orange-400" size={20} />
          <p className="text-2xl font-bold text-white">{predictions.filter((p) => !p.result).length}</p>
          <p className="text-xs text-gray-400">Pending</p>
        </div>
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-yellow-500/30 text-center">
          <Coins className="mx-auto mb-1 text-yellow-500" size={20} />
          <p className="text-2xl font-bold text-yellow-400">{tokens}</p>
          <p className="text-xs text-gray-400">Tokens</p>
        </div>
      </motion.div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              filter === f.key
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
          <p className="text-red-400 text-sm font-semibold">Error loading predictions</p>
          <p className="text-red-300 text-xs mt-1">{error}</p>
          <p className="text-red-300/60 text-xs mt-2">Check the browser console (F12) for details. Make sure Firestore security rules are configured.</p>
        </div>
      )}

      {/* Predictions List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : filteredPredictions.length === 0 ? (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
          <Target className="mx-auto mb-4 text-gray-600" size={48} />
          <h3 className="text-xl font-bold text-white mb-2">
            {filter === 'all' ? 'No predictions yet' : `No ${filter} predictions`}
          </h3>
          <p className="text-gray-400">
            {filter === 'all'
              ? 'Visit a player page and make your Over/Under picks!'
              : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPredictions.map((pred, index) => (
            <motion.div
              key={pred.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => {
                const nameSlug = encodeURIComponent(pred.playerName.toLowerCase().replace(/\s+/g, '-'));
                navigate(`/player/${pred.playerId}/${nameSlug}`, {
                  state: {
                    player: {
                      id: pred.playerId,
                      first_name: pred.playerName.split(' ')[0] || '',
                      last_name: pred.playerName.split(' ').slice(1).join(' ') || '',
                    },
                  },
                });
              }}
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 p-4 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Player Photo */}
                  <div className="flex-shrink-0">
                    <img
                      src={resolveImageUrl(`/images/players/${pred.playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim()}.png`)}
                      alt={pred.playerName}
                      loading="lazy"
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-600 group-hover:ring-yellow-500 transition-all"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                    <div className="hidden w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 items-center justify-center ring-2 ring-gray-600">
                      <span className="text-white text-sm font-bold">
                        {pred.playerName.split(' ').map((n) => n[0]).join('')}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-white font-semibold group-hover:text-yellow-400 transition-colors">
                      {pred.playerName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {PROP_LABELS[pred.propType] || pred.propType} · {pred.opponent ? `vs ${pred.opponent} · ` : ''}{pred.gameDate}
                      {pred.wager > 0 && (
                        <span className="ml-1.5 text-yellow-400/70">
                          · <Coins size={10} className="inline mb-0.5" /> {pred.wager}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Pick */}
                  <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
                    pred.pick === 'over'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}>
                    {pred.pick === 'over' ? 'OVER' : 'UNDER'} {parseFloat(pred.line).toFixed(1)}
                  </span>

                  {/* Result */}
                  {pred.result ? (
                    <div className="flex items-center gap-2">
                      {pred.actualValue != null && (
                        <span className="text-xs text-gray-400">
                          Actual: {parseFloat(pred.actualValue).toFixed(1)}
                        </span>
                      )}
                      {pred.wager > 0 && (
                        <span className={`text-xs font-bold ${
                          pred.result === 'win' ? 'text-green-400' :
                          pred.result === 'push' ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {pred.result === 'win' ? `+${pred.actualPayout || pred.wager}` :
                           pred.result === 'push' ? `±0` : `-${pred.wager}`}
                        </span>
                      )}
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        pred.result === 'win'
                          ? 'bg-green-600/30 text-green-300'
                          : pred.result === 'loss'
                          ? 'bg-red-600/30 text-red-300'
                          : 'bg-yellow-600/30 text-yellow-300'
                      }`}>
                        {pred.result.toUpperCase()}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-700 text-gray-400">
                        PENDING
                      </span>
                      {canEdit(pred) && (
                        <button
                          onClick={(e) => handleDelete(pred, e)}
                          disabled={actionLoading === pred.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
                          title="Undo prediction"
                        >
                          <RefreshCw size={14} className={actionLoading === pred.id ? 'animate-spin' : ''} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MyPredictions;
