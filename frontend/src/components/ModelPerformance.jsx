import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../utils/api';
import { TrendingUp, TrendingDown, Target, BarChart3, CheckCircle, XCircle, Clock, ArrowUp, ArrowDown, Shield, Zap } from 'lucide-react';

function ModelPerformance() {
  const [performance, setPerformance] = useState(null);
  const [gamePerformance, setGamePerformance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPerformance();
  }, []);

  const fetchPerformance = async () => {
    try {
      setLoading(true);
      const [propRes, gameRes] = await Promise.allSettled([
        api.get('/performance'),
        api.get('/performance/games')
      ]);
      if (propRes.status === 'fulfilled') setPerformance(propRes.value.data);
      if (gameRes.status === 'fulfilled') setGamePerformance(gameRes.value.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching performance:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-400"></div>
          <span className="ml-4 text-slate-400">Loading performance metrics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700">
        <p className="text-rose-400 text-center py-4">
          ⚠️ {error}
        </p>
        <button
          onClick={fetchPerformance}
          className="mt-4 mx-auto block px-4 py-2 bg-amber-400 text-slate-900 rounded-lg hover:bg-amber-300 transition-colors font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!performance || !performance.overall || (performance.overall.total === 0 && performance.overall.pending === 0)) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-8 border border-slate-700">
        <h3 className="text-2xl font-bold text-white mb-4 flex items-center justify-center">
          <Target className="mr-2 text-amber-400" size={28} />
          Model Performance
        </h3>
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-800 mb-4">
            <BarChart3 className="text-slate-600" size={40} />
          </div>
          <p className="text-slate-400 text-lg mb-2">
            No tracked predictions yet
          </p>
          <p className="text-slate-500 text-sm">
            Performance metrics will appear once predictions are tracked and resolved.
          </p>
        </div>
      </div>
    );
  }

  if (performance.overall.total === 0 && performance.overall.pending > 0) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-8 border border-slate-700">
        <h3 className="text-2xl font-bold text-white mb-4 flex items-center justify-center">
          <Target className="mr-2 text-amber-400" size={28} />
          Model Performance
        </h3>
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-400/10 mb-4">
            <Clock className="text-amber-400" size={40} />
          </div>
          <p className="text-white text-lg font-semibold mb-2">
            {performance.overall.pending} predictions pending
          </p>
          <p className="text-slate-400 text-sm">
            Results will appear after today's games are completed and evaluated.
          </p>
        </div>
      </div>
    );
  }

  const { overall, byPropType, recentPredictions, highConfidence } = performance;

  // Get color based on hit rate
  const getHitRateColor = (hitRate) => {
    if (hitRate >= 60) return 'text-emerald-400';
    if (hitRate >= 50) return 'text-amber-400';
    return 'text-rose-400';
  };

  // Get icon based on result
  const getResultIcon = (result) => {
    if (result === 'hit') return <CheckCircle className="text-emerald-400" size={20} />;
    if (result === 'miss') return <XCircle className="text-rose-400" size={20} />;
    return <Clock className="text-slate-400" size={20} />;
  };

  // Format prop type label
  const formatPropType = (propType) => {
    const labels = {
      points: 'Points',
      assists: 'Assists',
      rebounds: 'Rebounds',
      steals: 'Steals',
      blocks: 'Blocks',
      threes: '3-Pointers',
      threes_made: '3-Pointers',
      points_rebounds: 'Pts + Reb',
      points_assists: 'Pts + Ast',
      rebounds_assists: 'Reb + Ast',
      points_rebounds_assists: 'PRA',
      pra: 'PRA',
      pr: 'Pts + Reb',
      pa: 'Pts + Ast',
      ra: 'Reb + Ast'
    };
    return labels[propType] || propType;
  };

  // Sort prop types by total predictions
  const sortedPropTypes = Object.entries(byPropType).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-6">
      {/* Overall Performance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700"
      >
        <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
          <Target className="mr-2 text-amber-400" size={28} />
          Model Performance
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {/* Overall Hit Rate */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-slate-800 rounded-lg p-4 border border-slate-700"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400 font-medium">All Picks</span>
              <TrendingUp className="text-emerald-400" size={20} />
            </div>
            <div className={`text-3xl font-bold ${getHitRateColor(overall.hitRate)} mb-1`}>
              {overall.hitRate}%
            </div>
            <div className="text-xs text-slate-500">
              {overall.hits}/{overall.total} predictions
            </div>
          </motion.div>

          {/* High Confidence Hit Rate */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.12 }}
            className="bg-slate-800 rounded-lg p-4 border border-amber-500/30"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-amber-400 font-medium">Top Picks</span>
              <Zap className="text-amber-400" size={20} />
            </div>
            <div className={`text-3xl font-bold ${highConfidence?.total > 0 ? getHitRateColor(highConfidence.hitRate) : 'text-slate-500'} mb-1`}>
              {highConfidence?.total > 0 ? `${highConfidence.hitRate}%` : '-'}
            </div>
            <div className="text-xs text-slate-500">
              {highConfidence?.total > 0 ? `${highConfidence.hits}/${highConfidence.total} high confidence` : 'No data yet'}
            </div>
          </motion.div>

          {/* Total Predictions */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
            className="bg-slate-800 rounded-lg p-4 border border-slate-700"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400 font-medium">Total</span>
              <BarChart3 className="text-blue-400" size={20} />
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              {overall.total}
            </div>
            <div className="text-xs text-slate-500">
              Resolved predictions
            </div>
          </motion.div>

          {/* Avg Error */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-800 rounded-lg p-4 border border-slate-700"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400 font-medium">Avg Error</span>
              <TrendingDown className="text-orange-400" size={20} />
            </div>
            <div className="text-3xl font-bold text-orange-400 mb-1">
              {overall.avgError != null ? overall.avgError : '-'}
            </div>
            <div className="text-xs text-slate-500">
              {overall.hits} hits / {overall.misses} misses
            </div>
          </motion.div>

          {/* Pending */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 }}
            className="bg-slate-800 rounded-lg p-4 border border-slate-700"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400 font-medium">Pending</span>
              <Clock className="text-amber-400" size={20} />
            </div>
            <div className="text-3xl font-bold text-amber-400 mb-1">
              {overall.pending}
            </div>
            <div className="text-xs text-slate-500">
              Awaiting results
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Performance by Prop Type */}
      {sortedPropTypes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700"
        >
          <h4 className="text-xl font-bold text-white mb-4">Performance by Prop Type</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedPropTypes.map(([propType, stats], index) => (
              <motion.div
                key={propType}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + index * 0.05 }}
                className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-300 font-medium">{formatPropType(propType)}</span>
                  <span className={`text-xl font-bold ${getHitRateColor(stats.hitRate)}`}>
                    {stats.hitRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{stats.hits} hits / {stats.total} total</span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${stats.hitRate}%` }}
                    transition={{ delay: 0.5 + index * 0.05, duration: 0.6 }}
                    className={`h-full ${
                      stats.hitRate >= 60 ? 'bg-emerald-400' :
                      stats.hitRate >= 50 ? 'bg-amber-400' : 'bg-rose-400'
                    }`}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Game Predictions Performance */}
      {gamePerformance && (gamePerformance.total > 0 || gamePerformance.pending > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700"
        >
          <h4 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Shield className="text-blue-400" size={22} />
            Game Predictions
          </h4>

          {gamePerformance.total > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <span className="text-sm text-slate-400">Winner Accuracy</span>
                  <div className={`text-2xl font-bold mt-1 ${getHitRateColor(gamePerformance.winnerAccuracy)}`}>
                    {gamePerformance.winnerAccuracy}%
                  </div>
                  <span className="text-xs text-slate-500">{gamePerformance.total} games</span>
                </div>
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <span className="text-sm text-slate-400">Spread Accuracy</span>
                  <div className={`text-2xl font-bold mt-1 ${getHitRateColor(gamePerformance.spreadAccuracy)}`}>
                    {gamePerformance.spreadAccuracy}%
                  </div>
                </div>
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <span className="text-sm text-slate-400">Avg Spread Error</span>
                  <div className="text-2xl font-bold mt-1 text-orange-400">
                    {gamePerformance.avgSpreadError} pts
                  </div>
                </div>
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <span className="text-sm text-slate-400">Avg Total Error</span>
                  <div className="text-2xl font-bold mt-1 text-orange-400">
                    {gamePerformance.avgTotalError} pts
                  </div>
                </div>
              </div>

              {gamePerformance.recentPredictions?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left text-slate-400 font-medium py-2 px-2">Winner</th>
                        <th className="text-left text-slate-400 font-medium py-2 px-2">Matchup</th>
                        <th className="text-right text-slate-400 font-medium py-2 px-2">Pred Spread</th>
                        <th className="text-right text-slate-400 font-medium py-2 px-2">Score</th>
                        <th className="text-right text-slate-400 font-medium py-2 px-2">Spread Err</th>
                        <th className="text-right text-slate-400 font-medium py-2 px-2">Total Err</th>
                        <th className="text-left text-slate-400 font-medium py-2 px-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamePerformance.recentPredictions.map((gp, i) => (
                        <tr key={gp.gameId || i} className="border-b border-slate-800 hover:bg-slate-800/50">
                          <td className="py-2 px-2">
                            {gp.winnerCorrect ? (
                              <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                                <CheckCircle size={14} /> HIT
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-rose-400 text-xs font-semibold">
                                <XCircle size={14} /> MISS
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-white font-medium">{gp.matchup}</td>
                          <td className="py-2 px-2 text-right text-slate-300 font-medium">
                            {gp.predictedSpread > 0 ? `+${gp.predictedSpread}` : gp.predictedSpread}
                          </td>
                          <td className="py-2 px-2 text-right text-white font-semibold">{gp.actualScore || '-'}</td>
                          <td className="py-2 px-2 text-right text-orange-400">{gp.spreadError}</td>
                          <td className="py-2 px-2 text-right text-orange-400">{gp.totalError}</td>
                          <td className="py-2 px-2 text-slate-500 text-xs">
                            {gp.gameDate ? new Date(gp.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <Clock className="mx-auto text-amber-400 mb-2" size={32} />
              <p className="text-white font-semibold">{gamePerformance.pending} game predictions pending</p>
              <p className="text-slate-400 text-sm">Results will appear after games are completed</p>
            </div>
          )}
        </motion.div>
      )}

      {/* Recent Predictions */}
      {recentPredictions && recentPredictions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg shadow-2xl p-6 border border-slate-700"
        >
          <h4 className="text-xl font-bold text-white mb-4">Recent Player Predictions</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-medium py-2 px-2">Result</th>
                  <th className="text-left text-slate-400 font-medium py-2 px-2">Player</th>
                  <th className="text-left text-slate-400 font-medium py-2 px-2">Prop</th>
                  <th className="text-right text-slate-400 font-medium py-2 px-2">Line</th>
                  <th className="text-right text-slate-400 font-medium py-2 px-2">Pick</th>
                  <th className="text-right text-slate-400 font-medium py-2 px-2">Prob</th>
                  <th className="text-right text-slate-400 font-medium py-2 px-2">Actual</th>
                  <th className="text-left text-slate-400 font-medium py-2 px-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPredictions.slice(0, 15).map((pred, index) => {
                  const isHit = pred.result === 'hit';
                  const line = pred.bettingLine;
                  const pickedOver = pred.prediction != null && line != null && pred.prediction > line;
                  const overProb = pred.overProbability;
                  // Show the relevant probability (if picked over, show over%; if under, show 100 - over%)
                  const displayProb = overProb != null
                    ? (pickedOver ? overProb : (100 - overProb))
                    : null;
                  const isHighConf = pred.edgeStrength >= 8 || pred.confidence === 'High';

                  return (
                    <motion.tr
                      key={pred.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.45 + index * 0.03 }}
                      className={`border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${isHighConf ? 'bg-amber-400/5' : ''}`}
                    >
                      <td className="py-2 px-2">
                        {isHit ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                            <CheckCircle size={14} /> HIT
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-400 text-xs font-semibold">
                            <XCircle size={14} /> MISS
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-white font-medium">
                        {pred.playerName}
                        {isHighConf && <Zap size={12} className="inline ml-1 text-amber-400" />}
                      </td>
                      <td className="py-2 px-2 text-slate-300">{formatPropType(pred.propType)}</td>
                      <td className="py-2 px-2 text-right text-slate-300 font-medium">
                        {line != null ? line.toFixed(1) : '-'}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold">
                        {line != null ? (
                          <span className={pickedOver ? 'text-emerald-400' : 'text-rose-400'}>
                            {pickedOver ? (
                              <span className="flex items-center justify-end gap-1">
                                <ArrowUp size={14} /> O {pred.prediction?.toFixed(1)}
                              </span>
                            ) : (
                              <span className="flex items-center justify-end gap-1">
                                <ArrowDown size={14} /> U {pred.prediction?.toFixed(1)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-400">{pred.prediction?.toFixed(1) ?? '-'}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {displayProb != null ? (
                          <span className={`text-xs font-medium ${displayProb >= 60 ? 'text-emerald-400' : displayProb >= 55 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {displayProb.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-white font-semibold">
                        {pred.actual != null ? pred.actual.toFixed(1) : '-'}
                      </td>
                      <td className="py-2 px-2 text-slate-500 text-xs">
                        {pred.gameDate ? new Date(pred.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default ModelPerformance;
