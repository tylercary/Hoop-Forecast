import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Target, Activity, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';
import { getSportsbookBanner, getSportsbookBannerBg, getSportsbookDisplayName, normalizeSportsbookName } from '../utils/sportsbookLogos';

const SPORTSBOOK_ORDER = [
  'draftkings', 'fanduel', 'betmgm', 'caesars', 'bovada',
  'prizepicks', 'hardrock', 'hardrockbet', 'espnbet', 'fanatics',
  'underdog', 'underdogfantasy', 'barstool', 'betrivers',
  'betonline', 'williamhill', 'pointsbet', 'superbook'
];

function getSportsbookPriority(key) {
  if (!key) return 9999;
  const normalized = normalizeSportsbookName(key);
  const idx = SPORTSBOOK_ORDER.findIndex(sb => {
    const n = normalizeSportsbookName(sb);
    return normalized.includes(n) || n.includes(normalized);
  });
  return idx === -1 ? 9999 : idx;
}

function formatOdds(odds) {
  if (odds == null) return 'N/A';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function OddsCell({ odds, isBest }) {
  if (odds == null) return (
    <div className="bg-[#3d4f66] rounded-lg px-3 py-2.5 text-center">
      <span className="text-white text-sm font-medium opacity-50">N/A</span>
    </div>
  );
  return (
    <div className={`${isBest ? 'bg-[#697843]' : 'bg-[#3d4f66]'} rounded-lg px-3 py-2.5 text-center`}>
      <span className="text-white font-bold text-base">{formatOdds(odds)}</span>
    </div>
  );
}

function SpreadCell({ spread, odds, isBest }) {
  if (spread == null || odds == null) return (
    <div className="bg-[#3d4f66] rounded-lg px-3 py-2.5 text-center">
      <span className="text-white text-sm font-medium opacity-50">N/A</span>
    </div>
  );
  return (
    <div className={`${isBest ? 'bg-[#697843]' : 'bg-[#3d4f66]'} rounded-lg px-3 py-2.5 text-center`}>
      <span className="text-white font-bold text-base">
        {spread > 0 ? `+${spread}` : spread} <span className="text-sm font-normal">({formatOdds(odds)})</span>
      </span>
    </div>
  );
}

function TotalCell({ type, line, odds, isBest }) {
  if (line == null || odds == null) return (
    <div className="bg-[#3d4f66] rounded-lg px-3 py-2.5 text-center">
      <span className="text-white text-sm font-medium opacity-50">N/A</span>
    </div>
  );
  const label = type === 'over' ? 'O' : 'U';
  const bg = isBest ? (type === 'over' ? 'bg-[#697843]' : 'bg-[#7c6a42]') : 'bg-[#3d4f66]';
  return (
    <div className={`${bg} rounded-lg px-3 py-2.5 text-center`}>
      <span className="text-white font-bold text-base">
        {label} {line} <span className="text-sm font-normal">({formatOdds(odds)})</span>
      </span>
    </div>
  );
}

function BookmakerHeader({ bookmakerKey, bookmakerName }) {
  const banner = getSportsbookBanner(bookmakerKey);
  const bannerBg = getSportsbookBannerBg(bookmakerKey);
  const displayName = getSportsbookDisplayName(bookmakerKey);

  return (
    <div className="h-12 rounded-lg overflow-hidden relative" style={{ backgroundColor: bannerBg || '#000' }}>
      {banner && (
        <img
          src={banner}
          alt={displayName}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.parentElement.style.backgroundColor = '#2a3544';
            e.target.parentElement.style.border = '1px solid rgba(75,85,99,0.3)';
            if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'flex';
          }}
        />
      )}
      <span
        className="text-[10px] font-semibold text-white truncate items-center justify-center absolute inset-0"
        style={{ display: banner ? 'none' : 'flex' }}
      >
        {(displayName || bookmakerName || '').toUpperCase()}
      </span>
    </div>
  );
}

// ============================
// Odds Table Section
// ============================
function GameOddsTable({ odds, homeTeam, awayTeam }) {
  if (!odds) return null;

  const { spread, moneyline, totals } = odds;
  const hasSpread = spread?.all_bookmakers?.length > 0;
  const hasML = moneyline?.all_bookmakers?.length > 0;
  const hasTotals = totals?.all_bookmakers?.length > 0;

  if (!hasSpread && !hasML && !hasTotals) return null;

  // Collect all unique bookmaker keys across all markets
  const bookmakerMap = new Map();
  const addBooks = (books) => {
    for (const b of books || []) {
      const key = b.bookmaker_key;
      if (!bookmakerMap.has(key)) {
        bookmakerMap.set(key, { key, name: b.bookmaker });
      }
    }
  };
  addBooks(spread?.all_bookmakers);
  addBooks(moneyline?.all_bookmakers);
  addBooks(totals?.all_bookmakers);

  const sortedBooks = [...bookmakerMap.values()].sort(
    (a, b) => getSportsbookPriority(a.key) - getSportsbookPriority(b.key)
  );

  // Helpers to look up a bookmaker's data in a market
  const findBook = (market, key) => market?.all_bookmakers?.find(b => b.bookmaker_key === key);

  // Best odds calculations
  const bestHomeSpreadOdds = hasSpread ? Math.max(...spread.all_bookmakers.map(b => b.home_odds).filter(Boolean)) : null;
  const bestAwaySpreadOdds = hasSpread ? Math.max(...spread.all_bookmakers.map(b => b.away_odds).filter(Boolean)) : null;
  const bestHomeMLOdds = hasML ? Math.max(...moneyline.all_bookmakers.map(b => b.home_odds).filter(Boolean)) : null;
  const bestAwayMLOdds = hasML ? Math.max(...moneyline.all_bookmakers.map(b => b.away_odds).filter(Boolean)) : null;
  const bestOverOdds = hasTotals ? Math.max(...totals.all_bookmakers.map(b => b.over_odds).filter(Boolean)) : null;
  const bestUnderOdds = hasTotals ? Math.max(...totals.all_bookmakers.map(b => b.under_odds).filter(Boolean)) : null;

  return (
    <div className="space-y-6">
      {/* SPREAD */}
      {hasSpread && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Spread</h4>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 min-w-min">
              {/* Consensus Column */}
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#2a3544] border border-gray-600/30">
                  <span className="text-xs font-bold text-gray-300">CONSENSUS</span>
                </div>
                <SpreadCell spread={spread.line} odds={spread.away_odds} />
                <SpreadCell spread={spread.line ? -spread.line : null} odds={spread.home_odds} />
              </div>

              {/* Best Odds Column */}
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#f9c744]">
                  <span className="text-xs font-bold text-gray-900">BEST ODDS</span>
                </div>
                <SpreadCell
                  spread={spread.all_bookmakers.find(b => b.away_odds === bestAwaySpreadOdds)?.away_spread}
                  odds={bestAwaySpreadOdds}
                  isBest={true}
                />
                <SpreadCell
                  spread={spread.all_bookmakers.find(b => b.home_odds === bestHomeSpreadOdds)?.home_spread}
                  odds={bestHomeSpreadOdds}
                  isBest={true}
                />
              </div>

              {/* Sportsbook Columns */}
              {sortedBooks.map(book => {
                const s = findBook(spread, book.key);
                return (
                  <div key={book.key} className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                    <BookmakerHeader bookmakerKey={book.key} bookmakerName={book.name} />
                    <SpreadCell spread={s?.away_spread} odds={s?.away_odds} isBest={s?.away_odds === bestAwaySpreadOdds} />
                    <SpreadCell spread={s?.home_spread} odds={s?.home_odds} isBest={s?.home_odds === bestHomeSpreadOdds} />
                  </div>
                );
              })}
            </div>
            {/* Row labels */}
            <div className="flex gap-2 mt-1">
              <div className="w-40 flex-shrink-0" />
              <div className="w-40 flex-shrink-0" />
              {sortedBooks.map((_, i) => i === 0 ? (
                <div key="labels" className="absolute" style={{ display: 'none' }} />
              ) : null)}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <img src={getTeamLogo(awayTeam.abbreviation)} alt="" className="w-4 h-4 object-contain" />
              <span>{awayTeam.abbreviation}</span>
            </div>
            <span className="text-gray-600">|</span>
            <div className="flex items-center gap-2">
              <img src={getTeamLogo(homeTeam.abbreviation)} alt="" className="w-4 h-4 object-contain" />
              <span>{homeTeam.abbreviation}</span>
            </div>
          </div>
        </div>
      )}

      {/* MONEYLINE */}
      {hasML && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Moneyline</h4>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 min-w-min">
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#2a3544] border border-gray-600/30">
                  <span className="text-xs font-bold text-gray-300">CONSENSUS</span>
                </div>
                <OddsCell odds={moneyline.away_odds} />
                <OddsCell odds={moneyline.home_odds} />
              </div>
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#f9c744]">
                  <span className="text-xs font-bold text-gray-900">BEST ODDS</span>
                </div>
                <OddsCell odds={bestAwayMLOdds} isBest={true} />
                <OddsCell odds={bestHomeMLOdds} isBest={true} />
              </div>
              {sortedBooks.map(book => {
                const m = findBook(moneyline, book.key);
                return (
                  <div key={book.key} className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                    <BookmakerHeader bookmakerKey={book.key} bookmakerName={book.name} />
                    <OddsCell odds={m?.away_odds} isBest={m?.away_odds === bestAwayMLOdds} />
                    <OddsCell odds={m?.home_odds} isBest={m?.home_odds === bestHomeMLOdds} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <img src={getTeamLogo(awayTeam.abbreviation)} alt="" className="w-4 h-4 object-contain" />
              <span>{awayTeam.abbreviation}</span>
            </div>
            <span className="text-gray-600">|</span>
            <div className="flex items-center gap-2">
              <img src={getTeamLogo(homeTeam.abbreviation)} alt="" className="w-4 h-4 object-contain" />
              <span>{homeTeam.abbreviation}</span>
            </div>
          </div>
        </div>
      )}

      {/* TOTALS */}
      {hasTotals && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Game Total (Over/Under)</h4>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 min-w-min">
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#2a3544] border border-gray-600/30">
                  <span className="text-xs font-bold text-gray-300">CONSENSUS</span>
                </div>
                <TotalCell type="over" line={totals.line} odds={totals.over_odds} />
                <TotalCell type="under" line={totals.line} odds={totals.under_odds} />
              </div>
              <div className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                <div className="h-12 flex items-center justify-center rounded-lg bg-[#f9c744]">
                  <span className="text-xs font-bold text-gray-900">BEST ODDS</span>
                </div>
                <TotalCell type="over" line={totals.all_bookmakers.find(b => b.over_odds === bestOverOdds)?.line} odds={bestOverOdds} isBest={true} />
                <TotalCell type="under" line={totals.all_bookmakers.find(b => b.under_odds === bestUnderOdds)?.line} odds={bestUnderOdds} isBest={true} />
              </div>
              {sortedBooks.map(book => {
                const t = findBook(totals, book.key);
                return (
                  <div key={book.key} className="flex-shrink-0 w-40 flex flex-col gap-1.5">
                    <BookmakerHeader bookmakerKey={book.key} bookmakerName={book.name} />
                    <TotalCell type="over" line={t?.line} odds={t?.over_odds} isBest={t?.over_odds === bestOverOdds} />
                    <TotalCell type="under" line={t?.line} odds={t?.under_odds} isBest={t?.under_odds === bestUnderOdds} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================
// Prediction Section
// ============================
function PredictionCard({ prediction, homeTeam, awayTeam }) {
  if (!prediction) return null;

  const { homeWinProb, awayWinProb, predictedSpread, predictedTotal, confidence, analysis, factors, vegasComparison, injuries } = prediction;

  const confidenceColor = {
    high: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-red-500/20 text-red-400 border-red-500/30'
  }[confidence] || 'bg-gray-700 text-gray-400';

  const favored = predictedSpread < 0 ? awayTeam : homeTeam;
  const spreadAbs = Math.abs(predictedSpread);

  return (
    <div className="space-y-4">
      {/* Win Probability */}
      <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Target className="w-4 h-4 text-yellow-400" />
            Win Probability
          </h4>
          <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${confidenceColor}`}>
            {confidence?.toUpperCase()} CONFIDENCE
          </span>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <img src={getTeamLogo(awayTeam.abbreviation)} alt="" className="w-8 h-8 object-contain" />
            <span className="text-white font-bold text-xl">{awayWinProb}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-xl">{homeWinProb}%</span>
            <img src={getTeamLogo(homeTeam.abbreviation)} alt="" className="w-8 h-8 object-contain" />
          </div>
        </div>
        <div className="w-full h-4 rounded-full bg-gray-700 overflow-hidden flex">
          <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-l-full transition-all" style={{ width: `${awayWinProb}%` }} />
          <div className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-r-full transition-all" style={{ width: `${homeWinProb}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>{awayTeam.abbreviation}</span>
          <span>{homeTeam.abbreviation}</span>
        </div>
      </div>

      {/* Predicted Lines */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Predicted Spread</p>
          <p className="text-2xl font-bold text-white">
            {favored.abbreviation} {spreadAbs > 0 ? `-${spreadAbs}` : 'PK'}
          </p>
          {vegasComparison && (
            <p className="text-xs text-gray-500 mt-1">
              Vegas: {vegasComparison.vegasSpread > 0 ? `${awayTeam.abbreviation} +${vegasComparison.vegasSpread}` : `${homeTeam.abbreviation} ${vegasComparison.vegasSpread}`}
            </p>
          )}
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Predicted Total</p>
          <p className="text-2xl font-bold text-white">{predictedTotal}</p>
          {vegasComparison?.vegasTotal && (
            <p className="text-xs text-gray-500 mt-1">Vegas: {vegasComparison.vegasTotal}</p>
          )}
        </div>
      </div>

      {/* Factors */}
      {factors && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Model Factors
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Team Rating</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-white font-medium">{awayTeam.abbreviation}: {factors.awayStrength}</span>
                <span className="text-gray-600">vs</span>
                <span className="text-sm text-white font-medium">{homeTeam.abbreviation}: {factors.homeStrength}</span>
              </div>
            </div>
            {(factors.homeNetRating != null || factors.awayNetRating != null) && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Net Rating</span>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${factors.awayNetRating > 0 ? 'text-green-400' : factors.awayNetRating < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                    {awayTeam.abbreviation}: {factors.awayNetRating > 0 ? '+' : ''}{factors.awayNetRating}
                  </span>
                  <span className="text-gray-600">vs</span>
                  <span className={`text-sm font-medium ${factors.homeNetRating > 0 ? 'text-green-400' : factors.homeNetRating < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                    {homeTeam.abbreviation}: {factors.homeNetRating > 0 ? '+' : ''}{factors.homeNetRating}
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Home Court</span>
              <span className="text-sm text-green-400 font-medium">+{factors.homeCourt} pts ({homeTeam.abbreviation})</span>
            </div>
            {factors.streakAdj != null && factors.streakAdj !== 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Momentum</span>
                <span className={`text-sm font-medium ${factors.streakAdj > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {factors.streakAdj > 0 ? '+' : ''}{factors.streakAdj} pts ({factors.streakAdj > 0 ? homeTeam.abbreviation : awayTeam.abbreviation})
                </span>
              </div>
            )}
            {factors.homeInjuryPenalty > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">{homeTeam.abbreviation} Injury Impact</span>
                <span className="text-sm text-red-400 font-medium">-{factors.homeInjuryPenalty} pts</span>
              </div>
            )}
            {factors.awayInjuryPenalty > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">{awayTeam.abbreviation} Injury Impact</span>
                <span className="text-sm text-red-400 font-medium">-{factors.awayInjuryPenalty} pts</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Vegas Calibrated</span>
              <span className={`text-sm font-medium ${factors.vegasCalibrated ? 'text-green-400' : 'text-gray-500'}`}>
                {factors.vegasCalibrated ? 'Yes (55/45 blend)' : 'No (model only)'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Injury Impact */}
      {injuries && (injuries.home?.length > 0 || injuries.away?.length > 0) && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            Key Injuries Factored
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{ team: awayTeam, list: injuries.away }, { team: homeTeam, list: injuries.home }].map(({ team, list }) => (
              list?.length > 0 && (
                <div key={team.abbreviation}>
                  <div className="flex items-center gap-2 mb-2">
                    <img src={getTeamLogo(team.abbreviation)} alt="" className="w-4 h-4 object-contain" />
                    <span className="text-white font-semibold text-xs">{team.abbreviation}</span>
                  </div>
                  <div className="space-y-1">
                    {list.map((inj, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{inj.name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${inj.status === 'Out' ? 'text-red-400' : 'text-yellow-400'}`}>{inj.status}</span>
                          <span className="text-gray-500">Impact: {inj.impact}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            Analysis
          </h4>
          <p className="text-sm text-gray-300 leading-relaxed">{analysis}</p>
        </div>
      )}
    </div>
  );
}

// ============================
// Main Component
// ============================
export default function MatchupAnalyzer({ gameId, homeTeam, awayTeam }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('odds'); // 'odds' | 'prediction'

  useEffect(() => {
    let cancelled = false;
    async function fetchMatchup() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/games/${gameId}/matchup`);
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError('Failed to load matchup data');
        console.error('Matchup fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchMatchup();
    return () => { cancelled = true; };
  }, [gameId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-800 rounded w-48 mb-4" />
          <div className="h-48 bg-gray-800 rounded-lg mb-4" />
          <div className="h-48 bg-gray-800 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">{error || 'No matchup data available'}</p>
      </div>
    );
  }

  const home = data.homeTeam || homeTeam;
  const away = data.awayTeam || awayTeam;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Section Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection('odds')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeSection === 'odds'
              ? 'bg-yellow-500 text-gray-900'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          All Odds
        </button>
        <button
          onClick={() => setActiveSection('prediction')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeSection === 'prediction'
              ? 'bg-yellow-500 text-gray-900'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Game Prediction
        </button>
      </div>

      {/* Content */}
      <div className="bg-[#1a2332] rounded-lg p-5 border border-gray-700/50">
        {activeSection === 'odds' ? (
          <>
            <h3 className="text-xl font-bold text-white mb-5">Sportsbook Odds Comparison</h3>
            {data.odds ? (
              <GameOddsTable odds={data.odds} homeTeam={home} awayTeam={away} />
            ) : (
              <p className="text-gray-400 text-center py-8">No odds available for this game</p>
            )}
          </>
        ) : (
          <>
            <h3 className="text-xl font-bold text-white mb-5">HoopForecast Game Prediction</h3>
            {data.prediction ? (
              <PredictionCard prediction={data.prediction} homeTeam={home} awayTeam={away} />
            ) : (
              <p className="text-gray-400 text-center py-8">Prediction not available for this game</p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
