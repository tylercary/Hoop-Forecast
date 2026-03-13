import { motion } from 'framer-motion';
import { getSportsbookLogo, getSportsbookBanner, getSportsbookBannerBg, getSportsbookDisplayName, normalizeSportsbookName } from '../utils/sportsbookLogos';

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

function getSportsbookInfo(bookmakerKeyOrName) {
  if (!bookmakerKeyOrName) return null;

  const icon = getSportsbookLogo(bookmakerKeyOrName);
  const banner = getSportsbookBanner(bookmakerKeyOrName);
  const bannerBg = getSportsbookBannerBg(bookmakerKeyOrName);
  const displayName = getSportsbookDisplayName(bookmakerKeyOrName);

  return {
    name: displayName,
    icon: icon,
    banner: banner,
    bannerBg: bannerBg,
    displayName: displayName.toUpperCase()
  };
}

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
function OddsRow({ type, line, odds, isBest, hasIcon }) {
  const label = type === 'over' ? 'O' : 'U';
  const bgColor = isBest
    ? (type === 'over' ? 'bg-[#697843]' : 'bg-[#7c6a42]')
    : 'bg-[#3d4f66]';
  const padding = hasIcon ? 'pl-2 pr-8' : 'px-3';

  if (line == null || odds == null) {
    return (
      <div className={`${bgColor} rounded-lg ${padding} h-10 flex items-center justify-center`}>
        <span className="text-white text-sm font-medium opacity-50">N/A</span>
      </div>
    );
  }

  return (
    <div className={`${bgColor} rounded-lg ${padding} h-10 flex items-center justify-center whitespace-nowrap`}>
      <span className="text-white font-bold text-sm">
        {label} {parseFloat(line).toFixed(1)} <span className="text-xs font-normal">({formatOdds(odds)})</span>
      </span>
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
function PropOddsTable({ props, selectedProp }) {
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

  // Remove duplicates by bookmaker key (keep first occurrence)
  const seenKeys = new Set();
  const uniqueBookmakers = [];
  
  for (const bm of allBookmakers) {
    const key = (bm.bookmaker_key || bm.bookmaker || '').toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueBookmakers.push(bm);
    }
  }
  
  allBookmakers = uniqueBookmakers;

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="bg-[#1a2332] rounded-lg p-5 border border-gray-700/50"
    >
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="text-xl font-bold text-white">Prop Odds</h3>
        <span className="text-sm font-semibold text-yellow-400">{getPropDisplayLabel(selectedProp)} Over/Under</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-min">

          {/* OPEN LINE Column */}
          <div className="flex-shrink-0 w-36 flex flex-col">
            <div className="h-12 mb-2 flex items-center justify-center rounded-lg bg-[#2a3544] border border-gray-600/30">
              <span className="text-xs font-bold text-gray-300">CONSENSUS</span>
            </div>
            <div className="mb-1.5">
              <OddsRow type="over" line={consensusLine} odds={consensusOverOdds} isBest={false} />
            </div>
            <OddsRow type="under" line={consensusLine} odds={consensusUnderOdds} isBest={false} />
          </div>

          {/* BEST ODDS Column */}
          <div className="flex-shrink-0 w-36 flex flex-col">
            <div className="h-12 mb-2 flex items-center justify-center rounded-lg bg-[#f9c744]">
              <span className="text-xs font-bold text-gray-900">BEST ODDS</span>
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
                {/* Header: full-bleed banner image or text fallback */}
                <div className="h-12 mb-2 rounded-lg overflow-hidden relative" style={{ backgroundColor: info?.bannerBg || '#000000' }}>
                  {info?.banner && (
                    <img
                      src={info.banner}
                      alt={info.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.style.backgroundColor = '#2a3544';
                        e.target.parentElement.style.border = '1px solid rgba(75,85,99,0.3)';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                  )}
                  <span
                    className="text-[10px] font-semibold text-white truncate items-center justify-center absolute inset-0"
                    style={{ display: info?.banner ? 'none' : 'flex' }}
                  >
                    {info?.displayName || bookmaker.bookmaker.toUpperCase()}
                  </span>
                </div>
                <div className="mb-1.5">
                  <OddsRow type="over" line={bookmaker.line} odds={bookmaker.over_odds} isBest={isOverBest} />
                </div>
                <OddsRow type="under" line={bookmaker.line} odds={bookmaker.under_odds} isBest={isUnderBest} />
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

export default PropOddsTable;
