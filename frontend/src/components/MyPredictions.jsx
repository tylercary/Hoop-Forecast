import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Target, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import PredictionRow, { goToPlayer } from './PredictionRow';
import { getUserPredictions, getUserRecord, resolvePendingPredictions, syncUserRecord, deletePrediction } from '../services/firestoreService';


function Tile({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="py-3 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-none ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
  );
}

function MyPredictions() {
  const { user, tokens, addTokens, predictionsResolved } = useAuth();
  const navigate = useNavigate();
  const [predictions, setPredictions] = useState([]);
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

        // Sync the stored record from the predictions themselves (fixes stale counts).
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

        // Auto-resolve pending predictions (skip if AuthContext already resolved on login).
        const hasPending = preds.some((p) => !p.result);
        if (hasPending && !predictionsResolved) {
          setResolving(true);
          try {
            const { resolved, totalTokenChange } = await resolvePendingPredictions(user.uid, preds);
            if (resolved > 0) {
              if (totalTokenChange > 0) addTokens(totalTokenChange);
              setPredictions(await getUserPredictions(user.uid));
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
      <div className="panel p-10 text-center">
        <Target className="mx-auto mb-3 text-slate-600" size={36} />
        <h3 className="text-lg font-semibold text-white mb-1">Sign in to see your picks</h3>
        <p className="text-sm text-slate-400">Make over/under picks on player props and track your record.</p>
      </div>
    );
  }

  const wins = predictions.filter((p) => p.result === 'win').length;
  const losses = predictions.filter((p) => p.result === 'loss').length;
  const pushes = predictions.filter((p) => p.result === 'push').length;
  const pending = predictions.filter((p) => !p.result).length;
  const decided = wins + losses;
  const winPct = decided > 0 ? ((wins / decided) * 100).toFixed(1) : null;

  // Net tokens across settled wagers.
  const net = predictions.reduce((sum, p) => {
    if (!p.result || !(p.wager > 0)) return sum;
    if (p.result === 'win') return sum + (p.actualPayout || p.wager);
    if (p.result === 'loss') return sum - p.wager;
    return sum;
  }, 0);

  const counts = { all: predictions.length, pending, wins, losses };
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
  ];

  const filteredPredictions = predictions.filter((p) => {
    if (filter === 'pending') return !p.result;
    if (filter === 'wins') return p.result === 'win';
    if (filter === 'losses') return p.result === 'loss';
    return true;
  });

  const canEdit = (pred) => {
    if (pred.result) return false;
    const ct = pred.commenceTime;
    if (!ct) return true;
    return Date.now() < new Date(ct).getTime() - 5 * 60 * 1000; // up to 5 min before tip
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
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">My Predictions</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {predictions.length === 0 ? 'Your over/under picks will show up here.' : 'Every pick you have made, newest first.'}
          </p>
        </div>
        {resolving && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <RefreshCw size={12} className="animate-spin" /> Checking game results
          </span>
        )}
      </div>

      {/* Record */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel px-6 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 sm:divide-x divide-slate-700/60 gap-y-2">
          <Tile label="Record" value={`${wins}–${losses}–${pushes}`} sub="win – loss – push" />
          <Tile
            label="Win rate"
            value={winPct ? `${winPct}%` : '—'}
            sub={decided ? `${decided} decided` : 'nothing decided yet'}
            accent={winPct ? 'text-emerald-400' : 'text-slate-500'}
          />
          <Tile label="Pending" value={pending} sub="waiting on games" accent={pending ? 'text-amber-400' : 'text-white'} />
          <Tile
            label="Net tokens"
            value={net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0'}
            sub="from settled wagers"
            accent={net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-white'}
          />
          <Tile label="Balance" value={tokens} sub="tokens to wager" accent="text-amber-400" />
        </div>
      </motion.section>

      {/* Picks */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="panel p-6"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
          <h3 className="panel-title">Picks</h3>
          <div className="flex gap-1 p-1 rounded-lg bg-slate-900/60 border border-slate-700/60">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filter === f.key ? 'bg-amber-400 text-slate-900' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
                <span className={`ml-1.5 tabular-nums ${filter === f.key ? 'text-slate-900/70' : 'text-slate-600'}`}>
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 my-3">
            <p className="text-rose-400 text-sm font-semibold">Could not load your picks</p>
            <p className="text-rose-300/80 text-xs mt-1">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-slate-800">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse" />
            ))}
          </div>
        ) : filteredPredictions.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-white">
              {filter === 'all' ? 'No picks yet' : `No ${filter === 'pending' ? 'pending' : filter.replace(/s$/, '')} picks`}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {filter === 'all' ? 'Open a player page and pick over or under on a prop.' : 'Try another filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filteredPredictions.map((pred) => (
              <PredictionRow
                key={pred.id}
                pred={pred}
                showWager
                onClick={() => goToPlayer(navigate, pred)}
                trailing={
                  !pred.result && canEdit(pred) ? (
                    <button
                      onClick={(e) => handleDelete(pred, e)}
                      disabled={actionLoading === pred.id}
                      className="p-1.5 -mr-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
                      title="Undo this pick"
                      aria-label="Undo this pick"
                    >
                      <RefreshCw size={14} className={actionLoading === pred.id ? 'animate-spin' : ''} />
                    </button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}

export default MyPredictions;
