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

  // Mouse event handlers for dragging the line — only near the line
  const handleMouseDown = useCallback((e) => {
    if (!chartRef.current || line == null) return;

    const chartElement = chartRef.current;
    const bounds = chartElement.getBoundingClientRect();
    // Must match BarChart margins: top 15, bottom 55
    const chartTop = bounds.top + 15;
    const chartHeight = bounds.height - 15 - 55;
    const { min: minPts, max: maxPts } = yAxisDomainRef.current;
    const linePixelY = chartTop + ((maxPts - line) / (maxPts - minPts)) * chartHeight;

    if (Math.abs(e.clientY - linePixelY) > 20) return;

    setChartBounds(bounds);
    setIsDragging(true);
  }, [line]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !chartBounds || line == null) return;

    requestAnimationFrame(() => {
      // Must match BarChart margins: top 15, bottom 55
      const chartTop = chartBounds.top + 15;
      const chartHeight = chartBounds.height - 15 - 55;
      const mouseY = e.clientY;

      const relativeY = (mouseY - chartTop) / chartHeight;
      const clampedY = Math.max(0.05, Math.min(0.95, relativeY));

      const { min: minPoints, max: maxPoints } = yAxisDomainRef.current;
      const newValue = maxPoints - (clampedY * (maxPoints - minPoints));

      // Snap to nearest 0.5
      const roundedValue = Math.round(newValue * 2) / 2;
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
      
    } else {
      // If no next opponent, show no games for H2H
      filteredStats = [];
    }
  }

  // Filter buttons shared across all states
  const filterButtons = ['L5', 'L10', 'L15', ...(nextGameOpponent ? ['H2H'] : []), 'Season', '2025', '2024'];

  // Show empty state for H2H if no games found
  if (filter === 'H2H' && nextGameOpponent && filteredStats.length === 0) {
    return (
      <motion.div
        key={selectedProp}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-gray-800 rounded-xl shadow-2xl p-5 border border-gray-700"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">Prop Analysis</h3>
          <span className="text-xs text-gray-400">vs {nextGameOpponent}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-6">
          {filterButtons.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-yellow-500 text-gray-900'
                  : 'bg-gray-800/80 text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="text-center py-10">
          <p className="text-gray-500 mb-1">No games found vs {nextGameOpponent}</p>
          <p className="text-gray-600 text-xs">Try a different filter</p>
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

    let barColor = '#6b7280';
    if (line != null && typeof value === 'number' && !isNaN(value)) {
      barColor = value >= line ? '#10b981' : '#f43f5e';
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

  // Prop label for tooltip
  const propLabel = {
    points: 'pts', assists: 'ast', rebounds: 'reb', steals: 'stl',
    blocks: 'blk', turnovers: 'to', threes: '3pm', threes_made: '3pm',
    pr: 'pts+reb', pa: 'pts+ast', ra: 'reb+ast', pra: 'pts+reb+ast',
    points_rebounds: 'pts+reb', points_assists: 'pts+ast',
    rebounds_assists: 'reb+ast', points_rebounds_assists: 'pts+reb+ast',
  }[selectedProp] || 'value';

  // Handle empty stats
  if (!stats || stats.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl shadow-2xl p-5 border border-gray-700">
        <h3 className="text-lg font-bold text-white mb-4">Prop Analysis</h3>
        <p className="text-gray-400 text-center py-8 text-sm">No game data available</p>
      </div>
    );
  }

  // Loading state
  if (loading && prediction == null) {
    return (
      <div className="bg-gray-800 rounded-xl shadow-2xl p-5 border border-gray-700">
        <h3 className="text-lg font-bold text-white mb-4">Prop Analysis</h3>
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-gray-400 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const value = payload[0].value;
    const isOver = line != null && value >= line;
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
        <p className={`text-sm font-bold ${line != null ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-white'}`}>
          {value.toFixed(1)} <span className="text-gray-500 font-normal text-xs">{propLabel}</span>
        </p>
        {line != null && (
          <p className="text-[10px] text-gray-600 mt-0.5">
            {isOver ? '+' : ''}{(value - line).toFixed(1)} vs line
          </p>
        )}
      </div>
    );
  };

  return (
    <motion.div
      key={selectedProp}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="bg-gray-800 rounded-xl shadow-2xl p-5 border border-gray-700"
    >
      {/* Row 1: Title + Over/Under pills */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white">Prop Analysis</h3>
        {line != null && chartData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-2"
          >
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs font-semibold text-emerald-400">{overCount}</span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-xs font-semibold text-rose-400">{underCount}</span>
            </span>
          </motion.div>
        )}
      </div>

      {/* Row 2: Filters + Line control */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap gap-1.5">
          {filterButtons.map((f, i) => (
            <motion.button
              key={f}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-yellow-500 text-gray-900'
                  : 'bg-gray-800/80 text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </motion.button>
          ))}
        </div>
        {line != null && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-800/60 rounded-full px-2.5 py-1 border border-gray-700/30">
              <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wide">Line</span>
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
                className="w-12 bg-transparent text-white text-xs font-bold text-center focus:outline-none"
              />
            </div>
            {isLineAdjusted && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setAdjustedLine(null)}
                className="px-2 py-1 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors"
              >
                Reset
              </motion.button>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        ref={chartRef}
        onMouseDown={handleMouseDown}
        className={`relative ${isDragging ? 'cursor-grabbing' : 'cursor-default'} select-none`}
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          transform: 'translateZ(0)',
          willChange: isDragging ? 'transform' : 'auto'
        }}
      >
        <ResponsiveContainer width="100%" height={380}>
          <BarChart
            data={chartData}
            margin={{ top: 15, right: 50, left: 15, bottom: 55 }}
            barCategoryGap="15%"
          >
          <CartesianGrid strokeDasharray="4 4" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-45}
            textAnchor="end"
            height={75}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 500 }}
          />
          <YAxis
            domain={[minPoints, maxPoints]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#d1d5db', fontSize: 11, fontWeight: 500 }}
            width={35}
            ticks={yAxisTicks}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: 'rgba(255, 255, 255, 0.02)', radius: 4 }}
            position={{ y: 0 }}
          />

          <Bar
            dataKey="points"
            radius={[5, 5, 0, 0]}
            animationBegin={0}
            animationDuration={isDragging ? 0 : 600}
            animationEasing="ease-out"
            isAnimationActive={!isDragging}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                opacity={0.85}
              />
            ))}
          </Bar>

          {/* Draggable reference line */}
          {line != null && (
            <>
              <ReferenceLine
                y={line}
                stroke={isDragging ? "#60a5fa" : (isLineAdjusted ? "#3b82f6" : "rgba(255,255,255,0.7)")}
                strokeWidth={isDragging ? 2.5 : 1.5}
                strokeDasharray={isLineAdjusted ? "6 3" : "0"}
                style={{
                  transition: isDragging ? 'none' : 'all 0.15s ease-out',
                  willChange: 'transform'
                }}
                label={({ viewBox }) => {
                  const labelX = viewBox.width + viewBox.x - 5;
                  const labelY = viewBox.y;
                  return (
                    <g>
                      <rect
                        x={labelX - 33}
                        y={labelY - 10}
                        width={38}
                        height={20}
                        fill={isDragging ? "#1e40af" : (isLineAdjusted ? "#1e3a5f" : "#1f2937")}
                        rx={6}
                        stroke={isDragging ? "#60a5fa" : (isLineAdjusted ? "#3b82f6" : "#374151")}
                        strokeWidth={1}
                      />
                      <text
                        x={labelX - 14}
                        y={labelY + 4}
                        fill="#ffffff"
                        fontSize={11}
                        fontWeight={700}
                        textAnchor="middle"
                      >
                        {line.toFixed(1)}
                      </text>
                    </g>
                  );
                }}
              />
              <ReferenceLine
                y={line}
                stroke="transparent"
                strokeWidth={24}
                style={{ cursor: 'grab' }}
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
