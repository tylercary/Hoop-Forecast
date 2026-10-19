function ComparisonBox({ comparisonData }) {
  if (!comparisonData) {
    return null;
  }

  const { prediction, betting_line, recommendation } = comparisonData;

  // Determine recommendation display
  const getRecommendationDisplay = () => {
    if (!prediction || !betting_line) {
      return { text: 'Insufficient Data', color: 'gray', emoji: '⚪' };
    }

    if (recommendation === 'OVER') {
      return { text: 'Predicted OVER', color: 'green', emoji: '🟢' };
    } else if (recommendation === 'UNDER') {
      return { text: 'Predicted UNDER', color: 'red', emoji: '🔴' };
    } else {
      return { text: 'PUSH', color: 'yellow', emoji: '🟡' };
    }
  };

  const recDisplay = getRecommendationDisplay();
  const difference = prediction && betting_line 
    ? (prediction - betting_line).toFixed(1) 
    : null;

  return (
    <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
      <h3 className="text-2xl font-bold text-white mb-4 text-center">
        Prediction vs. Betting Line
      </h3>

      <div className="space-y-4">
        <div className="flex justify-between items-center p-4 bg-slate-700 rounded-lg">
          <span className="font-semibold text-slate-300">Our Prediction:</span>
          <span className={`text-2xl font-bold ${
            recommendation === 'OVER' ? 'text-emerald-400' :
            recommendation === 'UNDER' ? 'text-rose-400' :
            'text-amber-400'
          }`}>
            {prediction?.toFixed(1) || 'N/A'}
          </span>
        </div>

        <div className="flex justify-between items-center p-4 bg-slate-700 rounded-lg">
          <span className="font-semibold text-slate-300">Sportsbook Line:</span>
          <span className="text-2xl font-bold text-blue-400">
            {betting_line?.toFixed(1) || 'N/A'}
          </span>
        </div>

        {difference && (
          <div className="flex justify-between items-center p-4 bg-slate-700 rounded-lg">
            <span className="font-semibold text-slate-300">Difference:</span>
            <span className={`text-xl font-bold ${
              parseFloat(difference) > 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {parseFloat(difference) > 0 ? '+' : ''}{difference}
            </span>
          </div>
        )}

        <div className={`p-6 rounded-lg text-center ${
          recDisplay.color === 'green' ? 'bg-emerald-900/30 border-2 border-emerald-500' :
          recDisplay.color === 'red' ? 'bg-rose-900/30 border-2 border-rose-500' :
          recDisplay.color === 'yellow' ? 'bg-amber-900/30 border-2 border-amber-400' :
          'bg-slate-700 border-2 border-slate-500'
        }`}>
          <div className="text-4xl mb-2">{recDisplay.emoji}</div>
          <div className={`text-2xl font-bold ${
            recDisplay.color === 'green' ? 'text-emerald-400' :
            recDisplay.color === 'red' ? 'text-rose-400' :
            recDisplay.color === 'yellow' ? 'text-amber-400' :
            'text-slate-300'
          }`}>
            {recDisplay.text}
          </div>
          {difference && (
            <p className="text-sm text-slate-400 mt-2">
              {Math.abs(parseFloat(difference)).toFixed(1)} points {parseFloat(difference) > 0 ? 'above' : 'below'} the line
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 p-4 bg-amber-900/30 border border-amber-600 rounded-lg">
        <p className="text-xs text-amber-300 text-center">
          ⚠️ Predictions are for entertainment purposes only. Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}

export default ComparisonBox;

