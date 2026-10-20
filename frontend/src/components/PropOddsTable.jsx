import { motion } from 'framer-motion';
import { getSportsbookInfo, getSportsbookDisplayName, normalizeSportsbookName } from '../utils/sportsbookLogos';
import SportsbookHeader from './SportsbookHeader';

// Sportsbook priority order (matches BettingPros)
const SPORTSBOOK_ORDER = [
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'bovada',
  'prizepicks',
  'hardrock',
  'hardrockbet',
  'espnbet',
  'fanatics',
  'underdog',
  'underdogfantasy',
  'barstool',
  'betrivers',
  'betonline',
  'williamhill',
  'pointsbet',
  'superbook'
];


function getSportsbookPriority(bookmakerKey) {
  if (!bookmakerKey) return 9999;
  const normalized = normalizeSportsbookName(bookmakerKey);
  const index = SPORTSBOOK_ORDER.findIndex(sb => {
    const normalizedSb = normalizeSportsbookName(sb);
    return normalized.includes(normalizedSb) || normalizedSb.includes(normalized);
  });
  return index === -1 ? 9999 : index;
}

// Format odds
function formatOdds(odds) {
  if (odds == null) return 'N/A';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Format prop label
function getPropDisplayLabel(prop) {
  const labels = {
    points: 'Pts',
    assists: 'Ast',
    rebounds: 'Reb',
    threes: '3PM',
    threes_made: '3PM',
    steals: 'Stl',
    blocks: 'Blk',
    turnovers: 'TO',
    points_rebounds: 'Pts + Reb',
    points_assists: 'Pts + Ast',
    rebounds_assists: 'Reb + Ast',
    pra: 'Pts + Ast + Reb',
    pr: 'Pts + Reb',
    pa: 'Pts + Ast',
    ra: 'Reb + Ast',
    points_rebounds_assists: 'Pts + Ast + Reb'
  };
  return labels[prop] || prop.replace(/_/g, ' + ');
}

// OddsRow Component - Single Over or Under row
// modelProbability: the model's P(this side) at this book's line (0-1), shown
// in the tooltip; isBestBet marks the (book, line, side) with the best EV
function OddsRow({ type, line, odds, isBest, hasIcon, modelProbability, isBestBet }) {
  const label = type === 'over' ? 'O' : 'U';
  // Best price gets a green outline; everything else stays neutral
  const bgColor = isBest
    ? 'bg-emerald-500/10 border border-emerald-500/50'
    : 'bg-slate-800/80 border border-slate-700/60';
  const padding = hasIcon ? 'pl-2 pr-8' : 'px-3';

  if (line == null || odds == null) {
    return (
      <div className={`${bgColor} rounded-lg ${padding} h-10 flex items-center justify-center`}>
        <span className="text-white text-sm font-medium opacity-50">N/A</span>
      </div>
    );
  }

  const probText = modelProbability != null ? `Model: ${(modelProbability * 100).toFixed(0)}% ${type} ${parseFloat(line).toFixed(1)}` : null;
  const tooltip = isBestBet ? `Best bet across books · ${probText}` : probText;

  return (
    <div
      className={`${bgColor} rounded-lg ${padding} h-10 flex items-center justify-center whitespace-nowrap relative`}
      title={tooltip || undefined}
    >
      {isBestBet && (
        <span
          className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
          aria-label="Best bet"
        />
      )}
      <span className="text-white font-bold text-sm">
        {label} {parseFloat(line).toFixed(1)} <span className={`text-xs font-normal ${isBest ? 'text-emerald-300' : 'text-slate-400'}`}>({formatOdds(odds)})</span>
      </span>
      {modelProbability != null && (
        <span className={`ml-1.5 text-[10px] font-medium tabular-nums ${isBestBet ? 'text-amber-300' : 'text-slate-500'}`}>
          {(modelProbability * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

// SportsbookCard Component - Individual sportsbook column
function SportsbookCard({ bookmaker, bestOverOdds, bestUnderOdds, sportsbookInfo }) {
  const isOverBest = bookmaker.over_odds === bestOverOdds;
  const isUnderBest = bookmaker.under_odds === bestUnderOdds;
  
  return (
    <div className="flex-shrink-0 w-[165px]">
      {/* Over Row */}
      <div className="mb-2">
        <OddsRow 
          type="over" 
          line={bookmaker.line} 
          odds={bookmaker.over_odds}
          isBest={isOverBest}
        />
      </div>
      
      {/* Under Row */}
      <div>
        <OddsRow 
          type="under" 
          line={bookmaker.line} 
          odds={bookmaker.under_odds}
          isBest={isUnderBest}
        />
      </div>
    </div>
  );
}

// Main PropOddsContainer Component
// showModel: only signed-in users see the model's per-book probabilities and
// the best-bet marker (the same gate as the projection tiles)
function PropOddsTable({ props, selectedProp, showModel = false }) {
  if (!props || !selectedProp || !props[selectedProp]) {
    return null;
  }

  const propData = props[selectedProp];
  
  // Get all bookmakers from prop data
  let allBookmakers = [];
  
  if (propData.all_bookmakers && Array.isArray(propData.all_bookmakers)) {
    allBookmakers = propData.all_bookmakers;
  } else if (propData.bookmaker) {
    // Fallback to single bookmaker format
    allBookmakers = [{
      bookmaker: propData.bookmaker,
      bookmaker_key: propData.bookmaker_key || propData.bookmaker.toLowerCase().replace(/\s+/g, '_'),
      line: propData.line,
      over_odds: propData.over_odds || -110,
      under_odds: propData.under_odds || -110
    }];
  }

  if (allBookmakers.length === 0) {
    return null;
  }

  // One entry per book: its main line, the one it prices closest to even
  // (books also post alternate-line ladders; ties keep the first listed).
  // Same rule the server uses to score the best bet across books.
  const impliedProb = (odds) => {
    const o = Number(odds);
    if (!Number.isFinite(o) || o === 0) return null;
    return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
  };
  const offEven = (bm) => {
    const po = impliedProb(bm.over_odds);
    const pu = impliedProb(bm.under_odds);
    return po == null || pu == null ? 1 : Math.abs(po - 0.5) + Math.abs(pu - 0.5);
  };
  const mainByBook = new Map();
  for (const bm of allBookmakers) {
    const key = (bm.bookmaker_key || bm.bookmaker || '').toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    const cur = mainByBook.get(key);
    if (!cur || offEven(bm) < offEven(cur)) mainByBook.set(key, bm);
  }
  
  allBookmakers = [...mainByBook.values()];

  // Sort by priority order
  allBookmakers.sort((a, b) => {
    const priorityA = getSportsbookPriority(a.bookmaker_key || a.bookmaker);
    const priorityB = getSportsbookPriority(b.bookmaker_key || b.bookmaker);
    return priorityA - priorityB;
  });

  // Calculate consensus line (OPEN LINE) - most common line
  const lineCounts = {};
  allBookmakers.forEach(bm => {
    if (bm.line != null) {
      const lineKey = parseFloat(bm.line).toFixed(1);
      lineCounts[lineKey] = (lineCounts[lineKey] || 0) + 1;
    }
  });
  
  let consensusLine = propData.line;
  if (Object.keys(lineCounts).length > 0) {
    const mostCommonLine = Object.entries(lineCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
    consensusLine = parseFloat(mostCommonLine);
  }
  
  // Calculate consensus odds (average of all books with consensus line)
  const booksWithConsensusLine = allBookmakers.filter(bm => 
    bm.line != null && Math.abs(bm.line - consensusLine) < 0.1
  );
  
  let consensusOverOdds = -110;
  let consensusUnderOdds = -110;
  
  if (booksWithConsensusLine.length > 0) {
    const avgOver = booksWithConsensusLine.reduce((sum, bm) => sum + (bm.over_odds || -110), 0) / booksWithConsensusLine.length;
    const avgUnder = booksWithConsensusLine.reduce((sum, bm) => sum + (bm.under_odds || -110), 0) / booksWithConsensusLine.length;
    consensusOverOdds = Math.round(avgOver);
    consensusUnderOdds = Math.round(avgUnder);
  }

  // Calculate best odds (highest = best for bettor)
  const bestOverOdds = allBookmakers.reduce((best, bm) => {
    if (bm.over_odds == null) return best;
    if (best == null) return bm.over_odds;
    return bm.over_odds > best ? bm.over_odds : best;
  }, null);

  const bestUnderOdds = allBookmakers.reduce((best, bm) => {
    if (bm.under_odds == null) return best;
    if (best == null) return bm.under_odds;
    return bm.under_odds > best ? bm.under_odds : best;
  }, null);

  const bestOverBookmaker = allBookmakers.find(bm => bm.over_odds === bestOverOdds);
  const bestUnderBookmaker = allBookmakers.find(bm => bm.under_odds === bestUnderOdds);

  // Model probability per (book, line, side) and the best bet across books,
  // from the server's edge-model scoring (propData.book_edges / best_bet)
  const bookKey = (bm) => normalizeSportsbookName(bm?.bookmaker_key || bm?.bookmaker || '');
  const sameLine = (a, b) => a != null && b != null && Math.abs(parseFloat(a) - parseFloat(b)) < 0.01;
  const edgeFor = (bm, side) => showModel ? ((propData.book_edges || []).find(e =>
    e.side === side && bookKey(e) === bookKey(bm) && sameLine(e.line, bm.line)) || null) : null;
  const bestBet = showModel ? (propData.best_bet || null) : null;
  const isBestBetRow = (bm, side) => bestBet != null && !bestBet.dfs &&
    bestBet.side === side && bookKey(bestBet) === bookKey(bm) && sameLine(bestBet.line, bm.line);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="panel p-5"
    >
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="panel-title">Prop Odds</h3>
        <span className="panel-subtitle">{getPropDisplayLabel(selectedProp)} Over/Under</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-min">

          {/* OPEN LINE Column */}
          <div className="flex-shrink-0 w-36 flex flex-col">
            <div className="h-12 mb-2 flex items-center justify-center rounded-lg bg-slate-800/80 border border-slate-700/60">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Consensus</span>
            </div>
            <div className="mb-1.5">
              <OddsRow type="over" line={consensusLine} odds={consensusOverOdds} isBest={false} />
            </div>
            <OddsRow type="under" line={consensusLine} odds={consensusUnderOdds} isBest={false} />
          </div>

          {/* BEST ODDS Column */}
          <div className="flex-shrink-0 w-36 flex flex-col">
            <div className="h-12 mb-2 flex items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/40">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Best odds</span>
            </div>
            <div className="mb-1.5 relative">
              {bestOverBookmaker ? (
                <>
                  <div className="absolute top-1/2 -translate-y-1/2 right-1.5 z-10">
                    <img
                      src={getSportsbookInfo(bestOverBookmaker.bookmaker_key || bestOverBookmaker.bookmaker)?.icon}
                      alt="" className="w-6 h-6 object-contain rounded"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  </div>
                  <OddsRow type="over" line={bestOverBookmaker.line} odds={bestOverBookmaker.over_odds} isBest={true} hasIcon={true} />
                </>
              ) : (
                <OddsRow type="over" line={null} odds={null} isBest={false} />
              )}
            </div>
            <div className="relative">
              {bestUnderBookmaker ? (
                <>
                  <div className="absolute top-1/2 -translate-y-1/2 right-1.5 z-10">
                    <img
                      src={getSportsbookInfo(bestUnderBookmaker.bookmaker_key || bestUnderBookmaker.bookmaker)?.icon}
                      alt="" className="w-6 h-6 object-contain rounded"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  </div>
                  <OddsRow type="under" line={bestUnderBookmaker.line} odds={bestUnderBookmaker.under_odds} isBest={true} hasIcon={true} />
                </>
              ) : (
                <OddsRow type="under" line={null} odds={null} isBest={false} />
              )}
            </div>
          </div>

          {/* Individual Sportsbook Columns */}
          {allBookmakers.map((bookmaker, idx) => {
            const info = getSportsbookInfo(bookmaker.bookmaker_key || bookmaker.bookmaker);
            const isOverBest = bookmaker.over_odds === bestOverOdds;
            const isUnderBest = bookmaker.under_odds === bestUnderOdds;
            return (
              <div key={`${bookmaker.bookmaker_key || bookmaker.bookmaker}-${idx}`} className="flex-shrink-0 w-36 flex flex-col">
                <SportsbookHeader bookmaker={bookmaker.bookmaker_key || bookmaker.bookmaker} className="mb-2" />
                <div className="mb-1.5">
                  <OddsRow type="over" line={bookmaker.line} odds={bookmaker.over_odds} isBest={isOverBest}
                    modelProbability={edgeFor(bookmaker, 'over')?.model_probability ?? null}
                    isBestBet={isBestBetRow(bookmaker, 'over')} />
                </div>
                <OddsRow type="under" line={bookmaker.line} odds={bookmaker.under_odds} isBest={isUnderBest}
                  modelProbability={edgeFor(bookmaker, 'under')?.model_probability ?? null}
                  isBestBet={isBestBetRow(bookmaker, 'under')} />
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

export default PropOddsTable;
