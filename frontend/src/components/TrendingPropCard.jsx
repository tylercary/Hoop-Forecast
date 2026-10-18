import { useId, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { resolveImageUrl } from '../utils/api';
import FlameCrown from './FlameCrown';
import { getTeamLogo } from '../utils/teamLogos';
import { getSportsbookLogo, getSportsbookDisplayName, hasLogoMapping } from '../utils/sportsbookLogos';

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

const MAX_BOOK_LOGOS = 5;

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
  return name.split(' ').map(part => part[0]).join('').slice(0, 2);
}

// Card border drawn as an SVG outline (not a CSS mask, which Safari renders
// badly with the blurred banner): orange under the flames fading into grey,
// plus an ember of light that orbits it while the card is hovered.
function HeatBorder() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="heat-border" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-heat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="30%" stopColor="#fb923c" stopOpacity="0.55" />
          <stop offset="65%" stopColor="#475569" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#475569" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {/* Stroke is 3px on the edge; the card clips the outer half, leaving 1.5px */}
      <rect className="heat-border-ring" width="100%" height="100%" rx="12" stroke={`url(#${id}-heat)`} />
      <rect className="heat-border-ember" width="100%" height="100%" rx="12" pathLength="100" />
    </svg>
  );
}

// Sportsbook logo, falling back to initials when there's no logo file
function BookLogo({ book }) {
  const [failed, setFailed] = useState(false);
  const name = getSportsbookDisplayName(book);

  if (!hasLogoMapping(book) || failed) {
    return (
      <span
        title={name}
        className="w-6 h-6 rounded-full ring-2 ring-slate-900 bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-200"
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      src={getSportsbookLogo(book)}
      alt={name}
      title={name}
      className="w-6 h-6 rounded-full object-cover ring-2 ring-slate-900 bg-slate-800"
      onError={() => setFailed(true)}
    />
  );
}

function TrendingPropCard({ prop, rank, index, onSelect }) {
  const gameTime = formatGameTime(prop.commence_time);
  const overPct = prop.market_over_pct;
  const lean = overPct == null ? null : overPct >= 50 ? 'Over' : 'Under';
  const leanPct = overPct == null ? null : Math.max(overPct, 100 - overPct);
  const books = prop.books || [];
  const shownBooks = books.slice(0, MAX_BOOK_LOGOS);
  const isTopThree = rank <= 3;

  return (
    // Wrapper carries the hover lift so the glow moves with the card
    <motion.div
      // Opacity only: a framer transform would override the CSS hover lift
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index, 6) * 0.04, duration: 0.25, ease: 'easeOut' }}
      className={`trending-card relative isolate flex-shrink-0 w-[17.5rem] snap-start transition-transform duration-200 hover:-translate-y-1 ${
        isTopThree ? 'trending-card-hot' : ''
      }`}
    >
      {/* Soft fire glow behind the card, plus crisp flames rising off its top edge */}
      <div className="card-glow" aria-hidden="true" />
      <FlameCrown variant={index} height={isTopThree ? 54 : 40} />

      <button
        type="button"
        onClick={onSelect}
        className="group relative w-full text-left rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <HeatBorder />
        {/* White-hot highlight along the middle of the top edge, under the flames */}
        <div className="pointer-events-none absolute inset-x-6 top-0 z-20 h-px bg-gradient-to-r from-transparent via-amber-200/90 to-transparent" />

        {/* Header: headshot at half its native 260x190 size so it's sharp on retina */}
        <div className="relative h-[6.5rem]">
          {/* Translucent, blurred backdrop on its own layer (not wrapping the photo
              and badge), so the card's fire glows through behind the player */}
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" aria-hidden="true" />
          {prop.player_image ? (
            <img
              src={resolveImageUrl(prop.player_image)}
              alt={prop.player}
              loading="lazy"
              width={130}
              height={95}
              className="absolute bottom-0 left-3 w-[130px] h-[95px] object-contain object-bottom"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <div className="absolute bottom-3 left-4 w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold text-slate-200">
              {initials(prop.player)}
            </div>
          )}

          <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
            <span className={`relative inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold text-slate-900 shadow-sm shadow-black/40 ${
              isTopThree ? 'bg-orange-400' : 'bg-amber-400'
            }`}>
              <Flame size={12} strokeWidth={2.5} />
              #{rank}
            </span>
            <span className="text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
              {prop.bookCount} books
            </span>
          </div>

          {/* Fade the bottom of the headshot into the card body */}
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-900 to-transparent" />
        </div>

        {/* Body is solid so stats stay crisp over the fire */}
        <div className="bg-slate-900 px-4 pb-4 pt-2">
          {/* Player & matchup */}
          <h3 className="truncate text-base font-semibold text-white group-hover:text-amber-300 transition-colors">
            {prop.player}
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            {getTeamLogo(prop.away_team) && (
              <img src={getTeamLogo(prop.away_team)} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="font-medium text-slate-300">{prop.away_team}</span>
            <span>@</span>
            {getTeamLogo(prop.home_team) && (
              <img src={getTeamLogo(prop.home_team)} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="font-medium text-slate-300">{prop.home_team}</span>
            {gameTime && (
              <>
                <span className="text-slate-600">·</span>
                <span>{gameTime}</span>
              </>
            )}
          </div>

          {/* Line */}
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                {PROP_LABELS[prop.prop_type] || prop.prop_type}
              </p>
              <p className="text-3xl font-bold leading-none text-white tabular-nums">
                {prop.line}
              </p>
            </div>
            {prop.bestOdds && (
              <div className="text-right" title={`Best price at ${getSportsbookDisplayName(prop.bestOdds.sportsbook)}`}>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Best price</p>
                <p className="text-sm font-semibold text-white tabular-nums">
                  <span className={prop.bestOdds.type === 'over' ? 'text-emerald-400' : 'text-sky-400'}>
                    {prop.bestOdds.type === 'over' ? 'O' : 'U'}
                  </span>{' '}
                  {formatOdds(prop.bestOdds.odds)}
                </p>
              </div>
            )}
          </div>

          {/* Market lean: no-vig over/under split across books */}
          {lean && (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] font-medium">
                <span className={overPct > 50 ? 'text-emerald-400' : 'text-slate-500'}>Over {overPct}%</span>
                <span className={overPct < 50 ? 'text-sky-400' : 'text-slate-500'}>Under {100 - overPct}%</span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="bg-emerald-500/80" style={{ width: `${overPct}%` }} />
                <div className="bg-sky-500/80" style={{ width: `${100 - overPct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {overPct === 50 ? (
                  <>Market is <span className="font-semibold text-slate-200">split evenly</span></>
                ) : (
                  <>Market leans <span className="font-semibold text-slate-200">{lean.toLowerCase()}</span> ({leanPct}%)</>
                )}
              </p>
            </div>
          )}

          {/* Books listing this prop */}
          {shownBooks.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
              <div className="flex -space-x-1.5">
                {shownBooks.map(book => <BookLogo key={book} book={book} />)}
              </div>
              {books.length > MAX_BOOK_LOGOS && (
                <span className="text-xs text-slate-400">+{books.length - MAX_BOOK_LOGOS}</span>
              )}
              <span className="ml-auto text-xs font-medium text-amber-400 opacity-0 transition-opacity group-hover:opacity-100">
                View →
              </span>
            </div>
          )}
        </div>
      </button>
    </motion.div>
  );
}

export default TrendingPropCard;
