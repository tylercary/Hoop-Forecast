import { motion } from 'framer-motion';
import { memo } from 'react';

function PropCards({ props, selectedProp, onSelectProp }) {
  if (!props || Object.keys(props).length === 0) {
    return null;
  }

  const propLabels = {
    points: 'Points',
    assists: 'Assists',
    rebounds: 'Rebounds',
    threes: '3Pts Made',
    threes_made: '3Pts Made',
    steals: 'Steals',
    blocks: 'Blocks',
    turnovers: 'Turnovers',
    pra: 'Pts + Reb + Ast',
    pr: 'Pts + Reb',
    pa: 'Pts + Ast',
    ra: 'Reb + Ast',
    points_rebounds: 'Pts + Reb',
    points_assists: 'Pts + Ast',
    rebounds_assists: 'Reb + Ast',
    points_rebounds_assists: 'Pts + Reb + Ast'
  };

  const formatOdds = (odds) => {
    if (odds == null) return 'N/A';
    return odds > 0 ? `+${odds}` : `${odds}`;
  };
  
  // Sort props to display in a consistent order
  const propOrder = ['points', 'assists', 'rebounds', 'threes', 'threes_made', 'steals', 'blocks', 'turnovers', 'pra', 'pr', 'pa', 'ra', 'points_rebounds', 'points_assists', 'rebounds_assists', 'points_rebounds_assists'];
  const sortedProps = Object.entries(props).sort(([a], [b]) => {
    const aIndex = propOrder.indexOf(a);
    const bIndex = propOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2.5 mb-6">
      {sortedProps.map(([propType, propData], index) => {
        // Only skip if propData is null/undefined or line is null/undefined
        // Allow line = 0 (which is valid for some props like blocks)
        if (!propData || propData.line == null) {
          return null;
        }
        
        const isSelected = selectedProp === propType;
        const overOdds = propData.over_odds || -110;
        const underOdds = propData.under_odds || -110;
        
        return (
          <motion.button
            key={propType}
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: index * 0.02, duration: 0.2, ease: "easeOut" }}
            onClick={() => onSelectProp(propType)}
            aria-pressed={isSelected}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              isSelected
                ? 'border-amber-400 bg-amber-400/10'
                : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/70'
            }`}
          >
            <div className={`truncate text-[11px] font-semibold uppercase tracking-wide ${isSelected ? 'text-amber-400' : 'text-slate-400'}`}>
              {propLabels[propType] || propType}
            </div>
            <div className="mt-0.5 text-xl font-bold text-white tabular-nums">
              {propData.line.toFixed(1)}
            </div>
            <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
              O {formatOdds(overOdds)} · U {formatOdds(underOdds)}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

export default memo(PropCards);

