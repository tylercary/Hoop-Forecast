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
    pra: 'Points + Rebounds + Assists',
    pr: 'Points + Rebounds',
    pa: 'Points + Assists',
    ra: 'Rebounds + Assists',
    points_rebounds: 'Points + Rebounds',
    points_assists: 'Points + Assists',
    rebounds_assists: 'Rebounds + Assists',
    points_rebounds_assists: 'Points + Rebounds + Assists'
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
    <div className="flex flex-wrap gap-3 mb-6">
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
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              delay: index * 0.02,
              duration: 0.2,
              ease: "easeOut"
            }}
            whileHover={{
              scale: 1.05,
              y: -2,
              transition: { duration: 0.1, ease: "easeOut" }
            }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectProp(propType)}
            className={`px-4 py-3 rounded-xl transition-all relative overflow-hidden w-full sm:w-auto sm:min-w-[160px] ${
              isSelected
                ? 'bg-yellow-500 text-gray-900 shadow-lg shadow-yellow-500/50'
                : 'bg-gray-700 text-white hover:bg-gray-600 hover:shadow-lg'
            }`}
          >
            {isSelected && (
              <motion.div
                className="absolute inset-0 bg-gradient-to-br from-yellow-400 to-yellow-600"
                layoutId="selectedProp"
                transition={{ type: "spring", stiffness: 600, damping: 40 }}
              />
            )}
            <span className="relative z-10">
            <div className="text-sm font-semibold mb-1">
              {propLabels[propType] || propType}
            </div>
            <div className="text-lg font-bold mb-1">
              {propData.line.toFixed(1)}
            </div>
            <div className="text-xs opacity-90">
              O {formatOdds(overOdds)} | U {formatOdds(underOdds)}
            </div>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export default memo(PropCards);

