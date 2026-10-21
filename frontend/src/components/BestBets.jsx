import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Target, Lock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api, { resolveImageUrl } from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';
import { getSportsbookDisplayName } from '../utils/sportsbookLogos';

const PROP_LABELS = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: '3-Pointers',
  pra: 'Pts + Reb + Ast',
  pr: 'Pts + Reb',
  pa: 'Pts + Ast',
  ra: 'Reb + Ast',
  steals: 'Steals',
  blocks: 'Blocks'
};

const CONFIDENCE_STYLES = {
  High: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  Medium: 'border-slate-500/60 bg-slate-700/40 text-slate-200',
  Low: 'border-slate-700 bg-slate-800/60 text-slate-400'
};

// Survives back navigation like the trending props cache in Home
const cache = { data: null, fetchedAt: 0, TTL: 5 * 60 * 1000 };

// "Today 7:30 PM", "Tue 12:00 PM", in the viewer's timezone
function formatGameTime(isoTime) {
  if (!isoTime) return null;
  const date = new Date(isoTime);
  if (isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  const day = isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} ${time}`;
}

function formatOdds(odds) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function initials(name) {
  return (name || '').split(' ').map(part => part[0]).join('').slice(0, 2);
}

function BestBetCard({ pick, index, locked, onSelect, onSignIn }) {
  const isOver = pick.side === 'over';
  const sideColor = isOver ? 'text-emerald-400' : 'text-rose-400';
  const sideBg = isOver ? 'bg-emerald-500/80' : 'bg-rose-500/80';
  const gameTime = formatGameTime(pick.commence_time);
  const prob = pick.side_probability;
  const residual = pick.edge_residual;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index, 6) * 0.04, duration: 0.25, ease: 'easeOut' }}
      className="relative flex-shrink-0 w-[17.5rem] snap-start transition-transform duration-200 hover:-translate-y-1"
    >
      <button
        type="button"
        onClick={onSelect}
        className="group relative w-full text-left rounded-xl overflow-hidden border border-slate-700/60 hover:border-amber-400/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        {/* Header: headshot over a muted slate backdrop, same size as trending cards */}
        <div className="relative h-[6.5rem] bg-slate-800/60">
          {pick.player_image ? (
            <img
              src={resolveImageUrl(pick.player_image)}
              alt={pick.player}
              loading="lazy"
              width={130}
              height={95}
              className="absolute bottom-0 left-3 w-[130px] h-[95px] object-contain object-bottom"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <div className="absolute bottom-3 left-4 w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold text-slate-200">
              {initials(pick.player)}
            </div>
          )}

          <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold shadow-sm shadow-black/40 ${
              isOver ? 'bg-emerald-400 text-emerald-950' : 'bg-rose-400 text-rose-950'
            }`}>
              {isOver ? 'OVER' : 'UNDER'}
            </span>
            {pick.caution ? (
              <span
                className="inline-flex items-center rounded-full border border-slate-600/70 bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300"
                title={pick.caution.reasons?.includes('no_games_this_season')
                  ? 'No games yet this season: the model is working from last season and the stated edge has been reduced'
                  : 'The line sits far from this player\'s recent average, which usually means a changed role; the stated edge has been reduced'}
              >
                {pick.caution.reasons?.includes('no_games_this_season') ? 'Last season data' : 'Role change?'}
              </span>
            ) : pick.confidence && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                CONFIDENCE_STYLES[pick.confidence] || CONFIDENCE_STYLES.Low
              }`}>
                {pick.confidence}
              </span>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-900 to-transparent" />
        </div>

        <div className="bg-slate-900 px-4 pb-4 pt-2">
          {/* Player & matchup */}
          <h3 className="truncate text-base font-semibold text-white group-hover:text-amber-300 transition-colors">
            {pick.player}
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            {getTeamLogo(pick.away_team) && (
              <img src={getTeamLogo(pick.away_team)} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="font-medium text-slate-300">{pick.away_team || '—'}</span>
            <span>@</span>
            {getTeamLogo(pick.home_team) && (
              <img src={getTeamLogo(pick.home_team)} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="font-medium text-slate-300">{pick.home_team || '—'}</span>
            {gameTime && (
              <>
                <span className="text-slate-600">·</span>
                <span>{gameTime}</span>
              </>
            )}
          </div>

          {/* Prop + line, and the side's probability */}
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                {PROP_LABELS[pick.prop_type] || pick.prop_type}
              </p>
              <p className="text-3xl font-bold leading-none text-white tabular-nums">
                <span className={`text-lg font-semibold ${sideColor}`}>{isOver ? 'O' : 'U'}</span> {pick.line}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {pick.pick ? 'Pick' : 'Lean'}
              </p>
              {locked ? (
                <div className="relative flex h-7 items-center justify-end">
                  <span className={`select-none blur-sm opacity-50 text-2xl font-bold tabular-nums ${sideColor}`} aria-hidden="true">
                    88%
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSignIn?.(); } }}
                    className="absolute inset-y-0 right-0 flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-700/60 bg-slate-800/90 px-2 text-[11px] font-medium text-slate-300 hover:text-white"
                  >
                    <Lock size={11} className="text-slate-500" />
                    Sign in to view
                  </span>
                </div>
              ) : (
                <p className={`text-2xl font-bold leading-none tabular-nums ${sideColor}`}>
                  {prob != null ? `${Math.round(prob)}%` : '—'}
                </p>
              )}
            </div>
          </div>

          {/* Probability bar on the side's color */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${sideBg} ${locked ? 'opacity-30' : ''}`}
              style={{ width: `${locked ? 50 : Math.min(100, Math.max(0, prob ?? 0))}%` }}
            />
          </div>

          {/* Model vs line */}
          <p className={`mt-2 text-[11px] text-slate-400 tabular-nums ${locked ? 'blur-[3px] select-none' : ''}`} aria-hidden={locked}>
            Model <span className="font-semibold text-slate-200">{locked ? '—' : pick.projection ?? '—'}</span>
            {' '}vs line <span className="font-semibold text-slate-200">{pick.line}</span>
            {!locked && residual != null && (
              <span className="text-slate-500"> ({residual > 0 ? '+' : ''}{residual.toFixed(1)})</span>
            )}
          </p>

          {/* Best price for the side, when a book posts it */}
          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs">
            {pick.best_price ? (
              <span className="text-slate-400" title={`Best ${pick.side} price at ${getSportsbookDisplayName(pick.best_price.sportsbook)}`}>
                Best price{' '}
                <span className="font-semibold text-white tabular-nums">{formatOdds(pick.best_price.odds)}</span>
                {' '}<span className="text-slate-500">{getSportsbookDisplayName(pick.best_price.sportsbook)}</span>
              </span>
            ) : (
              <span className="text-slate-500">No book price</span>
            )}
            <span className="font-medium text-amber-400 opacity-0 transition-opacity group-hover:opacity-100">
              View →
            </span>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function thresholdsText(t) {
  if (!t) return null;
  return `Picks need ${t.over_probability_min}%+ over or ${t.under_probability_max}%- over probability, or a projection ${t.min_abs_edge_residual.toFixed(1)}+ off the line.`;
}

/**
 * Home page section: the slate's props where the edge model disagrees most
 * with the line. Signed-out viewers see the cards with the probability
 * blurred behind a sign-in prompt.
 */
function BestBets({ onSelectPlayer }) {
  const { user, openAuthModal } = useAuth();
  const location = useLocation();
  const [data, setData] = useState(cache.data);
  const [loading, setLoading] = useState(!cache.data);
  const rowRef = useRef(null);
  const sectionRef = useRef(null);

  useEffect(() => {
    const fresh = cache.data && Date.now() - cache.fetchedAt < cache.TTL;
    if (fresh) {
      setData(cache.data);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get('/trending/best-bets')
      .then(({ data: result }) => {
        if (cancelled) return;
        cache.data = result;
        cache.fetchedAt = Date.now();
        setData(result);
      })
      .catch((err) => {
        console.error('Error fetching best bets:', err);
        if (!cancelled) setData({ picks: [], thresholds: null });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // "Best bets" nav link lands on this section
  useEffect(() => {
    if (!loading && location.hash === '#best-bets' && sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, location.hash]);

  const picks = data?.picks || [];
  const locked = !user;

  const scrollRow = (direction) => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div id="best-bets" ref={sectionRef} className="max-w-7xl mx-auto px-4 sm:px-6 mb-12 scroll-mt-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1 leading-tight flex items-center gap-2">
              <Target size={22} className="text-amber-400" strokeWidth={2.5} />
              <span>Best Bets</span>
            </h2>
            <p className="text-slate-400 text-sm">
              Where the model disagrees most with the line
            </p>
          </div>
          {picks.length > 0 && (
            <div className="hidden sm:flex items-center gap-2">
              <button
                type="button"
                aria-label="Scroll best bets left"
                onClick={() => scrollRow(-1)}
                className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-amber-400/60 flex items-center justify-center transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Scroll best bets right"
                onClick={() => scrollRow(1)}
                className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-amber-400/60 flex items-center justify-center transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="rounded-full h-12 w-12 border-4 border-slate-700 border-t-amber-500 mx-auto"
            />
            <p className="mt-4 text-slate-300 text-sm font-medium">Loading best bets...</p>
          </div>
        ) : picks.length > 0 ? (
          <div
            ref={rowRef}
            className="-mx-4 sm:-mx-6 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 scroll-smooth pt-2 pb-6 [scrollbar-width:thin]"
          >
            <div className="flex w-max gap-5 px-4 sm:px-6">
              {picks.map((pick, index) => (
                <BestBetCard
                  key={`${pick.player}-${pick.prop_type}-${pick.game_date}`}
                  pick={pick}
                  index={index}
                  locked={locked}
                  onSignIn={openAuthModal}
                  onSelect={() => onSelectPlayer?.({
                    name: pick.player,
                    betting_line: pick.line,
                    prop_type: pick.prop_type,
                    home_team: pick.home_team,
                    away_team: pick.away_team,
                    event_id: pick.event_id
                  })}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="panel p-10 text-center">
            <Target size={40} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-300 mb-1 text-lg font-semibold">
              {data?.warming ? 'Predicting today\'s games…' : 'No strong edges yet for today\'s games'}
            </p>
            <p className="text-sm text-slate-400">
              {data?.warming ? 'Check back in a minute.' : thresholdsText(data?.thresholds)}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default BestBets;
