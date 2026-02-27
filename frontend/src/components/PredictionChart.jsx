import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';

function PredictionChart({ stats, prediction, bettingLine, selectedProp, loading, nextGameOpponent }) {
  const [filter, setFilter] = useState('L15'); // L5, L10, L15, H2H, Season, 2025, 2024
  const [adjustedLine, setAdjustedLine] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const chartRef = useRef(null);
  const [chartBounds, setChartBounds] = useState(null);
  const yAxisDomainRef = useRef({ min: 0, max: 100 });

  // Reset filter and adjusted line when prop changes
  useEffect(() => {
    setFilter('L15');
    setAdjustedLine(null);
  }, [selectedProp]);

  // Reset adjusted line when betting line changes
  useEffect(() => {
    setAdjustedLine(null);
  }, [bettingLine]);

  // Get the line to use (adjusted line takes priority, then betting line, then prediction)
  const originalLine = bettingLine != null ? bettingLine : (prediction != null ? prediction : null);
  const line = adjustedLine != null ? adjustedLine : originalLine;

  // Mouse event handlers for dragging the line
  const handleMouseDown = useCallback((e) => {
    if (!chartRef.current || line == null) return;

    const chartElement = chartRef.current;
    const bounds = chartElement.getBoundingClientRect();
    setChartBounds(bounds);
    setIsDragging(true);
  }, [line]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !chartBounds || line == null) return;

    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
      // Get chart dimensions (accounting for chart margins)
      const chartHeight = chartBounds.height - 80; // Account for margins (top 20 + bottom 60)
      const chartTop = chartBounds.top + 20; // Account for top margin
      const mouseY = e.clientY;

      // Calculate relative position (0 = top, 1 = bottom)
      const relativeY = (mouseY - chartTop) / chartHeight;

      // Clamp between 0.05 and 0.95 to keep line within chart
      const clampedY = Math.max(0.05, Math.min(0.95, relativeY));

      // Convert to value based on Y-axis domain
      const { min: minPoints, max: maxPoints } = yAxisDomainRef.current;

      // Invert Y (top = max, bottom = min)
      const newValue = maxPoints - (clampedY * (maxPoints - minPoints));

      // Round to nearest 0.1 for smoother dragging (was 0.5)
      const roundedValue = Math.round(newValue * 10) / 10;

      // Clamp to stay within reasonable bounds
      const clampedValue = Math.max(minPoints, Math.min(maxPoints, roundedValue));

      setAdjustedLine(clampedValue);
    });
  }, [isDragging, chartBounds, line]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setChartBounds(null);
  }, []);

  // Add/remove event listeners with passive flag for better performance
  useEffect(() => {
    if (isDragging) {
      // Use passive: false for mousemove to allow preventDefault if needed
      window.addEventListener('mousemove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Sort stats: most recent first
  const sortedStats = [...stats].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB - dateA;
  });

  // Determine what stat to chart based on selected prop
  const getChartValue = (game) => {
    if (!game) return 0;

    if (!selectedProp) {
      return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
    }

    try {
      switch (selectedProp) {
        case 'points':
          return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
        case 'assists':
          return typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
        case 'rebounds':
          return typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
        case 'steals':
          return typeof game.steals === 'number' ? game.steals : parseFloat(game.steals) || 0;
        case 'blocks':
          return typeof game.blocks === 'number' ? game.blocks : parseFloat(game.blocks) || 0;
        case 'turnovers':
          return typeof game.turnovers === 'number' ? game.turnovers : parseFloat(game.turnovers) || 0;
        case 'threes':
        case 'threes_made':
          // Try multiple field names for 3-pointers
          if (typeof game.threes_made === 'number') return game.threes_made;
          if (typeof game.threes === 'number') return game.threes;
          if (typeof game.fg3m === 'number') return game.fg3m;
          return parseFloat(game.threes_made || game.threes || game.fg3m) || 0;
        case 'pr':
        case 'points_rebounds':
          const pts1 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
          const reb1 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
          return pts1 + reb1;
        case 'pa':
        case 'points_assists':
          const pts2 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
          const ast2 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
          return pts2 + ast2;
        case 'ra':
        case 'rebounds_assists':
          const reb2 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
          const ast3 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
          return reb2 + ast3;
        case 'pra':
        case 'points_rebounds_assists':
          const pts3 = typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
          const reb3 = typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
          const ast4 = typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
          return pts3 + reb3 + ast4;
        default:
          return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
      }
    } catch (error) {
      console.error('Error getting chart value:', error, { game, selectedProp });
      return 0;
    }
  };

  // Filter stats based on selected filter
  let filteredStats = sortedStats;
  if (filter === 'L5') {
    filteredStats = sortedStats.slice(0, 5);
  } else if (filter === 'L10') {
    filteredStats = sortedStats.slice(0, 10);
  } else if (filter === 'L15') {
    filteredStats = sortedStats.slice(0, 15);
  } else if (filter === '2025') {
    filteredStats = sortedStats.filter(game => {
      // First try to use the season field if available
      if (game.season) {
        // 2025 filter = 2025-26 season (current season)
        return game.season === '2025-26' || game.season.includes('2025-26');
      }
      // Fallback to date parsing - games from 2025 calendar year
      try {
        const date = new Date(game.date);
        return date.getFullYear() === 2025;
      } catch {
        return true;
      }
    });
  } else if (filter === '2024') {
    filteredStats = sortedStats.filter(game => {
      // First try to use the season field if available
      if (game.season) {
        // 2024 filter = 2024-25 season (previous season)
        return game.season === '2024-25' || game.season.includes('2024-25');
      }
      // Fallback to date parsing - games from 2024 calendar year
      try {
        const date = new Date(game.date);
        return date.getFullYear() === 2024;
      } catch {
        return true;
      }
    });
  } else if (filter === 'Season') {
    // Show all games from current season (2025-26)
    filteredStats = sortedStats.filter(game => {
      if (game.season) {
        return game.season === '2025-26' || game.season.includes('2025-26');
      }
      try {
        const date = new Date(game.date);
        return date.getFullYear() === 2025;
      } catch {
        return false;
      }
    });
  } else if (filter === 'H2H') {
    // Filter to only show games against the next opponent (ALL historical games, no season filter)
    // Use ALL available stats, not just sortedStats (which might be limited)
    if (nextGameOpponent) {
      // Simple opponent normalization - no parsing needed since backend provides clean abbreviations
      const normalizeOpponent = (opp) => {
        if (!opp) return '';
        return opp.toString().toUpperCase().trim();
      };
      
      const nextOpponent = normalizeOpponent(nextGameOpponent);
      
      // Filter from ALL stats (not just sortedStats which might be limited by other filters)
      // This ensures we get all available games against this opponent
      filteredStats = sortedStats.filter(game => {
        if (!game.opponent) return false;
        const gameOpponent = normalizeOpponent(game.opponent);
        return gameOpponent === nextOpponent;
      });
      
      // Sort by date (most recent first) for H2H
      filteredStats = filteredStats.sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA;
      });
      
      // Debug log to help diagnose H2H issues
      if (filteredStats.length > 0) {
        console.log(`H2H Filter: Found ${filteredStats.length} games against ${nextGameOpponent} (normalized: ${nextOpponent})`);
      } else {
        console.log(`H2H Filter: No games found against ${nextGameOpponent} (normalized: ${nextOpponent}). Total stats available: ${sortedStats.length}`);
        // Log sample opponents to help debug
        const sampleOpponents = sortedStats.slice(0, 5).map(g => g.opponent).filter(Boolean);
        console.log(`H2H Filter: Sample opponents in stats:`, sampleOpponents);
      }
    } else {
      // If no next opponent, show no games for H2H
      filteredStats = [];
    }
  }

  // Show empty state for H2H if no games found
  if (filter === 'H2H' && nextGameOpponent && filteredStats.length === 0) {
  return (
    <motion.div 
      key={selectedProp}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
    >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-2xl font-bold text-white mb-2">Prop Analysis</h3>
            <p className="text-sm text-gray-400">
              Head-to-Head vs {nextGameOpponent}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {['L5', 'L10', 'L15', ...(nextGameOpponent ? ['H2H'] : []), 'Season', '2025', '2024'].map((f) => (
              <motion.button
                key={f}
                onClick={() => setFilter(f)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-200 ${
                  filter === f
                    ? 'bg-yellow-500 text-gray-900 font-semibold shadow-lg'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {f}
              </motion.button>
            ))}
          </div>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg mb-2">
            No previous games found against {nextGameOpponent}
          </p>
          <p className="text-gray-500 text-sm">
            This player has never played against this team in their career.
          </p>
        </div>
      </motion.div>
    );
  }

  // Reverse so oldest is on left, newest on right
  const chartData = [...filteredStats].reverse().map((game, index) => {
    if (!game) {
      return {
        name: 'N/A',
        points: 0,
        date: '',
        opponent: 'N/A',
        color: '#6b7280',
        isOver: false
      };
    }

    const value = getChartValue(game);

    // Determine bar color based on line - vibrant gradients for visual appeal
    let barColor = '#6b7280'; // Default gray
    let barGlow = 'none';
    if (line != null && typeof value === 'number' && !isNaN(value)) {
      if (value >= line) {
        // Over - vibrant green with glow
        barColor = '#10b981'; // Emerald green
        barGlow = '0 0 20px rgba(16, 185, 129, 0.6)';
      } else {
        // Under - vibrant pink/red with glow
        barColor = '#f43f5e'; // Rose/pink
        barGlow = '0 0 20px rgba(244, 63, 94, 0.6)';
      }
    }
    
    // Format date for label (format: M/D/YY)
    let dateLabel = '';
    try {
      if (game.date) {
        const dateObj = new Date(game.date);
        if (!isNaN(dateObj.getTime())) {
          const month = dateObj.getMonth() + 1;
          const day = dateObj.getDate();
          const year = dateObj.getFullYear().toString().slice(-2);
          dateLabel = `${month}/${day}/${year}`;
        }
      }
    } catch (e) {
      dateLabel = '';
    }
    
    const opponent = game.opponent || 'N/A';
    const isAway = game.home === false;
    const opponentLabel = isAway ? `@${opponent}` : opponent;
    
    return {
      name: `${opponentLabel} ${dateLabel}`,
      points: value,
      date: dateLabel,
      opponent: opponentLabel,
      color: barColor,
      isOver: line != null && value >= line
    };
  });

  // Calculate over/under stats
  const overCount = chartData.filter(d => d.isOver).length;
  const underCount = chartData.length - overCount;
  const dominantResult = overCount > underCount ? 'Over' : 'Under';
  const dominantCount = Math.max(overCount, underCount);

  // Show if line was adjusted
  const isLineAdjusted = adjustedLine != null && adjustedLine !== originalLine;

  // Calculate Y-axis domain with safety checks
  const allValues = chartData
    .map(d => d.points)
    .filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));

  if (line != null && typeof line === 'number' && !isNaN(line)) {
    allValues.push(line);
  }

  // Ensure we have at least some values
  if (allValues.length === 0) {
    allValues.push(0, 10);
  }

  const rawMin = Math.min(...allValues, 0);
  const rawMax = Math.max(...allValues, 10);

  const minPoints = Math.max(0, Math.floor((rawMin - 5) / 5) * 5);
  const maxPoints = Math.ceil((rawMax + 5) / 5) * 5;

  // Update domain ref for drag handling
  yAxisDomainRef.current = { min: minPoints, max: maxPoints };
  
  // Generate Y-axis ticks
  const yAxisTicks = [];
  const tickInterval = Math.max(5, Math.ceil((maxPoints - minPoints) / 6));
  for (let i = minPoints; i <= maxPoints; i += tickInterval) {
    yAxisTicks.push(i);
  }
  if (yAxisTicks[yAxisTicks.length - 1] < maxPoints) {
    yAxisTicks.push(maxPoints);
  }

  // Handle empty stats - render after all hooks
  if (!stats || stats.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
        <h3 className="text-2xl font-bold text-white mb-4">Prop Analysis</h3>
        <p className="text-gray-400 text-center py-8">No game data available</p>
      </div>
    );
  }

  // Show loading state if prediction is being fetched - render after all hooks
  if (loading && prediction == null) {
    return (
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
        <h3 className="text-2xl font-bold text-white mb-4">Prop Analysis</h3>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500"></div>
          <span className="ml-4 text-gray-400">Generating prediction...</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={selectedProp}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-6 border border-gray-700"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-2xl font-bold text-white mb-2">Prop Analysis</h3>
          {line != null && chartData.length > 0 && (
            <div className="space-y-1">
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-sm text-gray-300"
              >
                The <span className={`font-bold ${dominantResult === 'Over' ? 'text-green-400' : 'text-red-400'}`}>{dominantResult}</span> hit{' '}
                <span className="font-bold text-white">{dominantCount}/{chartData.length}</span>{' '}
                in the last {chartData.length} games at a line of{' '}
                <span className="font-bold text-yellow-400">{line.toFixed(1)}</span>
              </motion.p>
              {isLineAdjusted && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-blue-400 italic"
                >
                  Line adjusted from {originalLine.toFixed(1)} • Drag the line or click to reset
                </motion.p>
              )}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-xs text-gray-500 mt-1"
              >
                💡 Click and drag the white line to adjust
              </motion.p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {['L5', 'L10', 'L15', ...(nextGameOpponent ? ['H2H'] : []), 'Season', '2025', '2024'].map((f) => (
            <motion.button
              key={f}
              onClick={() => setFilter(f)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-200 ${
                filter === f
                  ? 'bg-yellow-500 text-gray-900 font-semibold shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {f}
            </motion.button>
          ))}
          {line != null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 ml-2"
            >
              <div className="flex items-center gap-1 bg-gray-700 rounded px-2 py-1">
                <label className="text-xs text-gray-400 font-medium">Line:</label>
                <input
                  type="number"
                  step="0.1"
                  value={line.toFixed(1)}
                  onChange={(e) => {
                    const newValue = parseFloat(e.target.value);
                    const { min, max } = yAxisDomainRef.current;
                    if (!isNaN(newValue) && newValue >= min && newValue <= max) {
                      setAdjustedLine(newValue);
                    }
                  }}
                  className="w-14 bg-gray-800 text-white text-sm font-semibold rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {isLineAdjusted && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAdjustedLine(null)}
                  className="px-2 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  title="Reset to original line"
                >
                  Reset
                </motion.button>
              )}
            </motion.div>
          )}
        </div>
      </div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.2 }}
        ref={chartRef}
        onMouseDown={handleMouseDown}
        className={`relative ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} select-none`}
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          transform: 'translateZ(0)', // Hardware acceleration
          willChange: isDragging ? 'transform' : 'auto'
        }}
      >
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 50, left: 20, bottom: 60 }}
            barCategoryGap="10%"
          >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.5} />
          <XAxis 
            dataKey="name"
            angle={-45}
            textAnchor="end"
            height={80}
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 500, fontFamily: 'Poppins' }}
            tickLine={{ stroke: '#6b7280' }}
          />
          <YAxis 
            domain={[minPoints, maxPoints]}
            stroke="#9ca3af"
            strokeWidth={1}
            tick={{ fill: '#d1d5db', fontSize: 12, fontWeight: 500, fontFamily: 'Poppins' }}
            tickLine={{ stroke: '#6b7280' }}
            width={40}
            ticks={yAxisTicks}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              padding: '10px',
              fontFamily: 'Poppins'
            }}
            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            formatter={(value) => {
              const propLabel = selectedProp === 'points' ? 'pts' :
                               selectedProp === 'assists' ? 'ast' :
                               selectedProp === 'rebounds' ? 'reb' :
                               selectedProp === 'steals' ? 'stl' :
                               selectedProp === 'blocks' ? 'blk' :
                               selectedProp === 'turnovers' ? 'to' :
                               selectedProp === 'threes' || selectedProp === 'threes_made' ? '3pm' :
                               selectedProp === 'pr' || selectedProp === 'points_rebounds' ? 'pts+reb' :
                               selectedProp === 'pa' || selectedProp === 'points_assists' ? 'pts+ast' :
                               selectedProp === 'ra' || selectedProp === 'rebounds_assists' ? 'reb+ast' :
                               selectedProp === 'pra' || selectedProp === 'points_rebounds_assists' ? 'pts+reb+ast' : 'value';
              return [`${value.toFixed(1)} ${propLabel}`, 'Value'];
            }}
            labelFormatter={(label) => <span style={{ fontWeight: 600, fontSize: '13px' }}>{label}</span>}
          />
          
          {/* Bars */}
          <Bar
            dataKey="points"
            radius={[6, 6, 0, 0]}
            animationBegin={0}
            animationDuration={isDragging ? 0 : 800}
            animationEasing="ease-out"
            isAnimationActive={!isDragging}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                stroke={entry.color}
                strokeWidth={0}
                opacity={0.95}
                style={{
                  filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.3))'
                }}
              />
            ))}
          </Bar>
          
          {/* Reference line at betting line - interactive draggable line */}
          {line != null && (
            <>
              <ReferenceLine
                y={line}
                stroke={isDragging ? "#60a5fa" : (isLineAdjusted ? "#3b82f6" : "#ffffff")}
                strokeWidth={isDragging ? 3 : 2.5}
                strokeDasharray="0"
                style={{
                  transition: isDragging ? 'none' : 'all 0.15s ease-out',
                  willChange: 'transform'
                }}
                label={({ viewBox }) => {
                  // Position label on the right side of the line
                  const labelX = viewBox.width + viewBox.x - 5;
                  const labelY = viewBox.y;
                  return (
                    <g>
                      {/* Background rectangle for better readability */}
                      <rect
                        x={labelX - 35}
                        y={labelY - 10}
                        width={40}
                        height={20}
                        fill={isDragging ? "#1e40af" : (isLineAdjusted ? "#2563eb" : "#1f2937")}
                        rx={4}
                        opacity={0.95}
                      />
                      {/* Line value text */}
                      <text
                        x={labelX - 15}
                        y={labelY + 4}
                        fill="#ffffff"
                        fontSize={12}
                        fontWeight={700}
                        fontFamily="Poppins"
                        textAnchor="middle"
                      >
                        {line.toFixed(1)}
                      </text>
                    </g>
                  );
                }}
              />
              {/* Invisible wider hitbox for easier dragging */}
              <ReferenceLine
                y={line}
                stroke="transparent"
                strokeWidth={20}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
      </motion.div>
    </motion.div>
  );
}

export default PredictionChart;
