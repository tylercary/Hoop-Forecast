import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts';
import { getGameSeason, getSeasonsInStats } from '../utils/seasons';

function PredictionChart({ stats, prediction, bettingLine, selectedProp, loading, nextGameOpponent }) {
  const [filter, setFilter] = useState('L15'); // L5, L10, L15, H2H, Season, or a season like '2025-26'
  const [adjustedLine, setAdjustedLine] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const chartRef = useRef(null);
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

  // Drag the betting line. The plot area is measured from the rendered grid,
  // so the pointer maps to the right value whatever the axis/margin sizes are.
  const plotAreaRef = useRef(null);

  const measurePlotArea = useCallback(() => {
    if (!chartRef.current) return null;
    const grid = chartRef.current.querySelector('.recharts-cartesian-grid');
    const rect = (grid || chartRef.current).getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (line == null) return;
    const plot = measurePlotArea();
    if (!plot || plot.height <= 0) return;

    const { min, max } = yAxisDomainRef.current;
    const linePixelY = plot.top + ((max - line) / (max - min)) * plot.height;
    if (Math.abs(e.clientY - linePixelY) > 20) return;

    e.preventDefault();
    plotAreaRef.current = plot;
    setIsDragging(true);
  }, [line, measurePlotArea]);

  const handlePointerMove = useCallback((e) => {
    const plot = plotAreaRef.current;
    if (!isDragging || !plot) return;

    const { min, max } = yAxisDomainRef.current;
    const relativeY = Math.max(0, Math.min(1, (e.clientY - plot.top) / plot.height));
    const value = max - relativeY * (max - min);
    // Snap to the nearest 0.5, like a real line
    setAdjustedLine(Math.max(min, Math.min(max, Math.round(value * 2) / 2)));
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    plotAreaRef.current = null;
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.userSelect = '';
    };
  }, [isDragging, handlePointerMove, handlePointerUp]);

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

  const seasons = getSeasonsInStats(stats);

  // Filter stats based on selected filter
  let filteredStats = sortedStats;
  if (filter === 'L5') {
    filteredStats = sortedStats.slice(0, 5);
  } else if (filter === 'L10') {
    filteredStats = sortedStats.slice(0, 10);
  } else if (filter === 'L15') {
    filteredStats = sortedStats.slice(0, 15);
  } else if (filter === 'Season' || seasons.includes(filter)) {
    // 'Season' is the most recent season with games
    const season = filter === 'Season' ? seasons[0] : filter;
    filteredStats = sortedStats.filter(game => getGameSeason(game) === season);
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
  const filterButtons = ['L5', 'L10', 'L15', ...(nextGameOpponent ? ['H2H'] : []), 'Season', ...seasons];

  // Show empty state for H2H if no games found
  if (filter === 'H2H' && nextGameOpponent && filteredStats.length === 0) {
    return (
      <motion.div
        key={selectedProp}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="panel p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="panel-title">Prop Analysis</h3>
          <span className="text-xs text-slate-400">vs {nextGameOpponent}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-6">
          {filterButtons.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                filter === f
                  ? 'bg-amber-400 text-slate-900'
                  : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700/80 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="text-center py-10">
          <p className="text-slate-500 mb-1">No games found vs {nextGameOpponent}</p>
          <p className="text-slate-600 text-xs">Try a different filter</p>
        </div>
      </motion.div>
    );
  }

  // Reverse so oldest is on left, newest on right
  const chartData = [...filteredStats].reverse().map((game) => {
    if (!game) {
      return { name: 'N/A', points: 0, date: '', opponent: 'N/A', color: '#64748b', isOver: false };
    }

    const value = getChartValue(game);

    let barColor = '#64748b';
    if (line != null && typeof value === 'number' && !isNaN(value)) {
      barColor = value >= line ? '#10b981' : '#f43f5e';
    }

    // Short date for the axis (M/D) and a fuller one for the tooltip (M/D/YY)
    let dateLabel = '';
    let dateFull = '';
    if (game.date) {
      const dateObj = new Date(game.date);
      if (!isNaN(dateObj.getTime())) {
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        dateLabel = `${month}/${day}`;
        dateFull = `${month}/${day}/${String(dateObj.getFullYear()).slice(-2)}`;
      }
    }

    const opponent = game.opponent || 'N/A';
    const opponentLabel = game.home === false ? `@${opponent}` : opponent;

    return {
      name: `${opponentLabel} · ${dateFull}`,
      points: value,
      date: dateLabel,
      opponent: opponentLabel,
      color: barColor,
      isOver: line != null && value >= line
    };
  });

  // Calculate over/under stats for the games shown
  const overCount = chartData.filter(d => d.isOver).length;
  const underCount = chartData.length - overCount;
  const hitRate = chartData.length ? Math.round((overCount / chartData.length) * 100) : 0;

  const values = chartData.map(d => d.points).filter(v => typeof v === 'number' && isFinite(v));
  const average = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  const formatValue = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // Show if line was adjusted
  const isLineAdjusted = adjustedLine != null && adjustedLine !== originalLine;

  // Y-axis domain: pick the smallest "nice" step that keeps the axis to ~8
  // ticks, so low-volume props (threes, blocks) don't get a 0-5-10 axis.
  const allValues = [...values];
  if (line != null && typeof line === 'number' && !isNaN(line)) allValues.push(line);
  if (allValues.length === 0) allValues.push(0, 10);
  const rawMin = Math.min(...allValues, 0);
  const rawMax = Math.max(...allValues, 1);

  let step = 20;
  let minPoints = 0;
  let maxPoints = rawMax;
  for (const candidate of [1, 2, 5, 10, 20]) {
    const lo = Math.max(0, Math.floor((rawMin - candidate) / candidate) * candidate);
    const hi = Math.ceil((rawMax + candidate) / candidate) * candidate;
    if ((hi - lo) / candidate <= 8) {
      step = candidate;
      minPoints = lo;
      maxPoints = hi;
      break;
    }
    step = candidate;
    minPoints = lo;
    maxPoints = hi;
  }

  // Update domain ref for drag handling
  yAxisDomainRef.current = { min: minPoints, max: maxPoints };

  const yAxisTicks = [];
  for (let tick = minPoints; tick <= maxPoints; tick += step) yAxisTicks.push(tick);

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
      <div className="panel p-5">
        <h3 className="panel-title mb-4">Prop Analysis</h3>
        <p className="text-slate-400 text-center py-8 text-sm">No game data available</p>
      </div>
    );
  }

  // Loading state
  if (loading && prediction == null) {
    return (
      <div className="panel p-5">
        <h3 className="panel-title mb-4">Prop Analysis</h3>
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const game = payload[0].payload;
    const value = game.points;
    const isOver = line != null && value >= line;
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 shadow-xl">
        <p className="mb-0.5 text-[11px] text-slate-400">{game.name}</p>
        <p className={`text-sm font-bold tabular-nums ${line != null ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-white'}`}>
          {formatValue(value)} <span className="text-xs font-normal text-slate-500">{propLabel}</span>
        </p>
        {line != null && (
          <p className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
            {isOver ? '+' : ''}{(value - line).toFixed(1)} vs line{average != null ? ` · ${value >= average ? '+' : ''}${(value - average).toFixed(1)} vs avg` : ''}
          </p>
        )}
      </div>
    );
  };

  // Two-line x-axis tick: opponent on top, date underneath (no rotation).
  // When bars get narrow, only every 2nd/3rd label is drawn, counted from the
  // most recent game so the latest one always keeps its label.
  const GameTick = ({ x, y, payload, index, visibleTicksCount, width }) => {
    const game = chartData[payload.index];
    if (!game) return null;
    const perTick = width / Math.max(visibleTicksCount, 1);
    const skip = perTick >= 44 ? 1 : perTick >= 24 ? 2 : 3;
    if ((visibleTicksCount - 1 - index) % skip !== 0) return null;
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" dy={12} fill="#cbd5e1" fontSize={10} fontWeight={600}>{game.opponent}</text>
        <text textAnchor="middle" dy={24} fill="#64748b" fontSize={9}>{game.date}</text>
      </g>
    );
  };

  // Value above each bar, skipped when bars are too thin to read
  const BarValue = ({ viewBox, value }) => {
    if (!viewBox || viewBox.width < 20 || value == null) return null;
    return (
      <text x={viewBox.x + viewBox.width / 2} y={viewBox.y - 6} textAnchor="middle" fill="#cbd5e1" fontSize={10} fontWeight={600}>
        {formatValue(value)}
      </text>
    );
  };

  // Label pinned to the left end of the average line
  const AvgLabel = ({ viewBox }) => (
    <g>
      <rect x={viewBox.x + 4} y={viewBox.y - 9} width={56} height={18} rx={5} fill="#1e293b" stroke="#fbbf24" strokeOpacity={0.5} />
      <text x={viewBox.x + 32} y={viewBox.y + 4} textAnchor="middle" fill="#fbbf24" fontSize={10} fontWeight={700}>
        AVG {formatValue(average)}
      </text>
    </g>
  );

  return (
    <motion.div
      key={selectedProp}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="panel p-5"
    >
      {/* Row 1: Title + summary of the games shown */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="panel-title">Prop Analysis</h3>
        {line != null && chartData.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="flex flex-wrap items-center gap-1.5 text-xs font-semibold"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {overCount} over
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              {underCount} under
            </span>
            <span className="rounded-full border border-slate-700/60 bg-slate-800/80 px-2.5 py-1 text-slate-200 tabular-nums">
              {hitRate}% over
            </span>
            {average != null && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-300 tabular-nums">
                Avg {formatValue(average)}
              </span>
            )}
          </motion.div>
        )}
      </div>

      {/* Row 2: Filters + Line control */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {filterButtons.map((f, i) => (
            <motion.button
              key={f}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                filter === f
                  ? 'bg-amber-400 text-slate-900'
                  : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700/80 hover:text-white'
              }`}
            >
              {f}
            </motion.button>
          ))}
        </div>
        {line != null && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-800/60 rounded-full px-2.5 py-1 border border-slate-700/30">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Line</span>
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
                className="px-2 py-1 rounded-full text-[10px] font-semibold bg-amber-400/10 text-amber-300 border border-amber-400/30 hover:bg-amber-400/20 transition-colors"
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
        onPointerDown={handlePointerDown}
        className={`relative select-none ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{ touchAction: 'pan-y', WebkitUserSelect: 'none' }}
      >
        <ResponsiveContainer width="100%" height={360}>
          <BarChart
            data={chartData}
            margin={{ top: 24, right: 56, left: 4, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="opponent"
              interval={0}
              height={40}
              axisLine={false}
              tickLine={false}
              tick={<GameTick />}
            />
            <YAxis
              domain={[minPoints, maxPoints]}
              ticks={yAxisTicks}
              axisLine={false}
              tickLine={false}
              width={32}
              tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)', radius: 4 }}
            />

            {/* Average over the games shown */}
            {average != null && (
              <ReferenceLine
                y={average}
                stroke="#fbbf24"
                strokeOpacity={0.55}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={<AvgLabel />}
              />
            )}

            <Bar
              dataKey="points"
              radius={[4, 4, 0, 0]}
              maxBarSize={44}
              animationDuration={isDragging ? 0 : 500}
              isAnimationActive={!isDragging}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.9} />
              ))}
              <LabelList dataKey="points" content={<BarValue />} />
            </Bar>

            {/* Draggable betting line */}
            {line != null && (
              <>
                <ReferenceLine
                  y={line}
                  stroke={isDragging ? '#fbbf24' : (isLineAdjusted ? '#f59e0b' : 'rgba(255,255,255,0.75)')}
                  strokeWidth={isDragging ? 2.5 : 1.5}
                  strokeDasharray={isLineAdjusted ? '6 3' : '0'}
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
                          fill="#1e293b"
                          rx={6}
                          stroke={isDragging ? '#fbbf24' : (isLineAdjusted ? '#f59e0b' : '#334155')}
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
                {/* Wide invisible hit area so the line is easy to grab */}
                <ReferenceLine y={line} stroke="transparent" strokeWidth={24} style={{ cursor: 'grab' }} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
      {line != null && (
        <p className="mt-1 text-[11px] text-slate-500">
          Drag the line, or edit the number above, to test a different line.
        </p>
      )}
    </motion.div>
  );
}

export default PredictionChart;
