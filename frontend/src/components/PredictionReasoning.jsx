import { motion } from 'framer-motion';

function PredictionReasoning({ predictionData, selectedProp, playerName }) {
  if (!predictionData) {
    return (
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
        <h3 className="text-xl font-bold text-white mb-4">Prediction Reasoning</h3>
        <p className="text-gray-400 text-center py-8">No prediction data available</p>
      </div>
    );
  }

  // Get the prediction data for the selected prop
  let propPrediction = null;
  if (selectedProp === 'points') {
    // For points, check both predictions object and direct prediction
    // Prioritize full prediction object from predictions.points
    if (predictionData.predictions?.points) {
      propPrediction = predictionData.predictions.points;
    } else {
      // Fallback: construct from top-level fields
      propPrediction = {
        predicted_points: predictionData.prediction,
        confidence: predictionData.confidence,
        error_margin: predictionData.error_margin,
        analysis: predictionData.analysis || null, // Check top-level analysis too
        recommendation: predictionData.recommendation || null,
        stats: predictionData.stats || {}
      };
    }
  } else {
    // For other props, check if we have the prediction
    propPrediction = predictionData.predictions?.[selectedProp];
  }

  // Debug logging
  console.log(`[PredictionReasoning] selectedProp: ${selectedProp}`);
  console.log(`[PredictionReasoning] predictionData.predictions:`, predictionData.predictions);
  console.log(`[PredictionReasoning] propPrediction:`, propPrediction);

  if (!propPrediction) {
    return (
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
        <h3 className="text-xl font-bold text-white mb-4">Prediction Reasoning</h3>
        <p className="text-gray-400 text-center py-8">Prediction reasoning not available for this prop. The prediction may still be loading.</p>
      </div>
    );
  }

  const stats = propPrediction.stats || {};
  // Use new 'analysis' field (top level or in stats), fallback to 'justification' for backward compatibility
  const analysis = propPrediction.analysis || stats.analysis || stats.justification || propPrediction.justification || 'No detailed reasoning provided by the AI model.';
  
  // Debug logging for analysis
  console.log(`[PredictionReasoning] analysis found:`, !!analysis);
  console.log(`[PredictionReasoning] analysis value:`, analysis?.substring(0, 100));
  const predictedValue = propPrediction[`predicted_${selectedProp}`] || propPrediction.predicted_value || propPrediction.predicted_points || 'N/A';
  // Confidence can be string ("Low"|"Medium"|"High") or number (0-100)
  const confidenceRaw = propPrediction.confidence || stats.confidence;
  const confidence = typeof confidenceRaw === 'string' ? confidenceRaw : (typeof confidenceRaw === 'number' ? `${confidenceRaw.toFixed(1)}%` : 'N/A');
  const errorMargin = propPrediction.error_margin || stats.error_margin || 'N/A';
  // Confidence level is the string version (Low/Medium/High)
  const confidenceLevel = typeof confidenceRaw === 'string' ? confidenceRaw : (stats.confidence_level || propPrediction.confidence_level || null);

  const propLabels = {
    points: 'Points',
    assists: 'Assists',
    rebounds: 'Rebounds',
    threes: '3-Pointers Made',
    steals: 'Steals',
    blocks: 'Blocks',
    points_rebounds: 'Points + Rebounds',
    points_assists: 'Points + Assists'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
    >
      <h3 className="text-xl font-bold text-white mb-6">
        Prediction Reasoning: {propLabels[selectedProp] || selectedProp.replace(/_/g, ' ')}
      </h3>

      {/* Prediction Summary */}
      <div className="mb-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-400 mb-1">Predicted Value</div>
            <div className="text-2xl font-bold text-yellow-400">
              {typeof predictedValue === 'number' ? predictedValue.toFixed(1) : predictedValue}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Confidence</div>
            <div className={`text-2xl font-bold ${
              confidenceLevel === 'High' ? 'text-green-400' :
              confidenceLevel === 'Medium' ? 'text-yellow-400' :
              confidenceLevel === 'Low' ? 'text-orange-400' :
              'text-white'
            }`}>
              {confidence}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Error Margin</div>
            <div className="text-2xl font-bold text-gray-300">
              {typeof errorMargin === 'number' ? `±${errorMargin.toFixed(1)}` : errorMargin}
            </div>
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      <div className="mb-6">
        <h4 className="text-lg font-semibold text-white mb-3">
          AI Analysis
          {confidenceLevel && (
            <span className={`ml-3 text-sm font-normal ${
              confidenceLevel === 'High' ? 'text-green-400' :
              confidenceLevel === 'Medium' ? 'text-yellow-400' :
              'text-orange-400'
            }`}>
              ({confidenceLevel} Confidence)
            </span>
          )}
        </h4>
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{analysis}</p>
        </div>
      </div>

      {/* Statistical Breakdown */}
      {stats && Object.keys(stats).length > 0 && (
        <div>
          <h4 className="text-lg font-semibold text-white mb-3">Statistical Factors</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.overall_avg != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Overall Average</div>
                <div className="text-lg font-semibold text-white">{stats.overall_avg.toFixed(1)}</div>
              </div>
            )}
            {stats.recent_3_avg != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Last 3 Games Avg</div>
                <div className="text-lg font-semibold text-white">{stats.recent_3_avg.toFixed(1)}</div>
              </div>
            )}
            {stats.recent_5_avg != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Last 5 Games Avg</div>
                <div className="text-lg font-semibold text-white">{stats.recent_5_avg.toFixed(1)}</div>
              </div>
            )}
            {stats.momentum != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Momentum</div>
                <div className={`text-lg font-semibold ${stats.momentum > 0 ? 'text-green-400' : stats.momentum < 0 ? 'text-red-400' : 'text-white'}`}>
                  {stats.momentum > 0 ? '+' : ''}{stats.momentum.toFixed(1)}
                </div>
              </div>
            )}
            {stats.std_dev != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Std Deviation</div>
                <div className="text-lg font-semibold text-white">{stats.std_dev.toFixed(1)}</div>
              </div>
            )}
            {stats.consistency_factor != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Consistency</div>
                <div className="text-lg font-semibold text-white">{(stats.consistency_factor * 100).toFixed(0)}%</div>
              </div>
            )}
            {stats.home_avg != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Home Average</div>
                <div className="text-lg font-semibold text-white">{stats.home_avg.toFixed(1)}</div>
              </div>
            )}
            {stats.away_avg != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Away Average</div>
                <div className="text-lg font-semibold text-white">{stats.away_avg.toFixed(1)}</div>
              </div>
            )}
            {stats.trend != null && (
              <div className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-400 mb-1">Trend</div>
                <div className={`text-lg font-semibold ${
                  stats.trend === 'increasing' ? 'text-green-400' : 
                  stats.trend === 'decreasing' ? 'text-red-400' : 
                  'text-white'
                }`}>
                  {stats.trend}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default PredictionReasoning;

