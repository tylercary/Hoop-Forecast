import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Star, X } from 'lucide-react';
import { resolveImageUrl } from '../utils/api';
import { getTeamAbbrev, getTeamLogo } from '../utils/teamLogos';

// Order and short labels for the prop chips
const PROPS = [
  { key: 'points', label: 'PTS' },
  { key: 'rebounds', label: 'REB' },
  { key: 'assists', label: 'AST' },
  { key: 'threes', label: '3PM' },
  { key: 'pra', label: 'PRA' },
  { key: 'pr', label: 'P+R' },
  { key: 'pa', label: 'P+A' },
  { key: 'ra', label: 'R+A' }
];
const PROP_ORDER = PROPS.map(p => p.key);
const propLabel = (key) => PROPS.find(p => p.key === key)?.label || key?.toUpperCase();

function formatGameTime(isoTime) {
  if (!isoTime) return null;
  const date = new Date(isoTime);
  if (isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  const day = isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const initials = (name) => name.split(' ').map(part => part[0]).join('').slice(0, 2);

/**
 * Rows come in one per player per prop. Group them into games, each holding
 * one entry per player with all of that player's lines.
 */
function groupByGame(rows) {
  const games = new Map();
  for (const row of rows) {
    if (!games.has(row.event_id)) {
      games.set(row.event_id, {
        id: row.event_id,
        home: getTeamAbbrev(row.home_team),
        away: getTeamAbbrev(row.away_team),
        time: row.commence_time,
        players: new Map()
      });
    }
    const game = games.get(row.event_id);
    if (!game.players.has(row.name)) {
      game.players.set(row.name, { ...row, lines: {} });
    }
    game.players.get(row.name).lines[row.prop_type] = row;
  }
  return [...games.values()]
    .map(game => ({
      ...game,
      players: [...game.players.values()].sort((a, b) =>
        (b.lines.points?.betting_line || 0) - (a.lines.points?.betting_line || 0)
      )
    }))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

function PlayerCard({ player, propFilter, onSelect, favorite, onToggleFavorite }) {
  const props = PROP_ORDER.filter(key => player.lines[key]);
  const primary = propFilter !== 'all' && player.lines[propFilter] ? propFilter : props[0];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(player.lines[primary])}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(player.lines[primary]); }}
      className="group relative flex gap-3 rounded-xl border border-slate-700/70 bg-slate-900 p-3 cursor-pointer transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-amber-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      {/* Headshot at 0.4x of its native 260x190, still sharp on retina */}
      <div className="relative flex-shrink-0 w-[104px] h-[76px] overflow-hidden rounded-lg bg-gradient-to-b from-slate-800 to-slate-800/40">
        {player.player_image ? (
          <img
            src={resolveImageUrl(player.player_image)}
            alt={player.name}
            loading="lazy"
            width={104}
            height={76}
            className="absolute inset-0 w-full h-full object-contain object-bottom"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-slate-400">
            {initials(player.name)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">
            {player.name}
          </h3>
          {onToggleFavorite && (
            <button
              type="button"
              aria-label={favorite ? `Remove ${player.name} from favorites` : `Add ${player.name} to favorites`}
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
              className="-m-1 p-1 flex-shrink-0"
            >
              <Star size={15} className={favorite ? 'text-amber-400 fill-amber-400' : 'text-slate-500 hover:text-amber-400'} />
            </button>
          )}
        </div>

        {/* Every line this player has; the filtered prop is highlighted */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {props.map(key => {
            const isActive = key === primary;
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => { e.stopPropagation(); onSelect(player.lines[key]); }}
                title={`${propLabel(key)} ${player.lines[key].betting_line} · ${player.lines[key].bookmaker}`}
                className={`rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
                  isActive
                    ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                    : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
              >
                <span className={isActive ? 'font-semibold text-amber-400' : 'text-slate-500'}>{propLabel(key)}</span>{' '}
                <span className="font-semibold">{player.lines[key].betting_line}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FeaturedPlayers({ players, loading, onSelectPlayer, user, isFavorite, toggleFavorite }) {
  const [search, setSearch] = useState('');
  const [propFilter, setPropFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');

  const games = useMemo(() => groupByGame(players), [players]);
  const teams = useMemo(
    () => [...new Set(games.flatMap(g => [g.away, g.home]))].sort(),
    [games]
  );
  const availableProps = useMemo(
    () => PROPS.filter(p => players.some(row => row.prop_type === p.key)),
    [players]
  );

  const query = search.trim().toLowerCase();
  const visibleGames = games
    .filter(game => teamFilter === 'all' || game.home === teamFilter || game.away === teamFilter)
    .map(game => ({
      ...game,
      players: game.players.filter(player =>
        (!query || player.name.toLowerCase().includes(query)) &&
        (propFilter === 'all' || player.lines[propFilter])
      )
    }))
    .filter(game => game.players.length > 0);

  const playerCount = visibleGames.reduce((sum, game) => sum + game.players.length, 0);
  const hasFilters = query || propFilter !== 'all' || teamFilter !== 'all';
  const clearFilters = () => { setSearch(''); setPropFilter('all'); setTeamFilter('all'); };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 leading-tight">Featured Players</h2>
          <p className="text-slate-400 text-sm">Every player with a line, grouped by game</p>
        </div>
        {!loading && players.length > 0 && (
          <span className="flex-shrink-0 whitespace-nowrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400">
            {plural(playerCount, 'player')}
          </span>
        )}
      </div>

      {/* Controls */}
      {!loading && players.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-64">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a player"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
            />
          </div>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0 [scrollbar-width:none]">
            {[{ key: 'all', label: 'All' }, ...availableProps].map(prop => (
              <button
                key={prop.key}
                type="button"
                onClick={() => setPropFilter(prop.key)}
                className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  propFilter === prop.key
                    ? 'border-amber-400 bg-amber-400 text-slate-900'
                    : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
              >
                {prop.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 lg:ml-auto">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              aria-label="Filter by team"
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white focus:border-amber-400/60 focus:outline-none cursor-pointer"
            >
              <option value="all">All teams</option>
              {teams.map(team => <option key={team} value={team}>{team}</option>)}
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[102px] rounded-xl border border-slate-800 bg-slate-900/60 animate-pulse" />
          ))}
        </div>
      ) : visibleGames.length > 0 ? (
        <div className="space-y-8">
          {visibleGames.map((game, gameIndex) => (
            <motion.section
              key={game.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(gameIndex, 4) * 0.05, duration: 0.25 }}
            >
              {/* Game header */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  {getTeamLogo(game.away) && <img src={getTeamLogo(game.away)} alt="" className="w-6 h-6 object-contain" />}
                  <span>{game.away}</span>
                  <span className="text-slate-500 font-normal">@</span>
                  {getTeamLogo(game.home) && <img src={getTeamLogo(game.home)} alt="" className="w-6 h-6 object-contain" />}
                  <span>{game.home}</span>
                </div>
                {formatGameTime(game.time) && (
                  <span className="whitespace-nowrap text-xs text-slate-400">{formatGameTime(game.time)}</span>
                )}
                <div className="hidden sm:block h-px flex-1 bg-slate-800" />
                <span className="ml-auto sm:ml-0 whitespace-nowrap text-xs text-slate-500">{plural(game.players.length, 'player')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {game.players.map(player => {
                  const favoriteId = String(player.player_id || player.name);
                  return (
                    <PlayerCard
                      key={player.name}
                      player={player}
                      propFilter={propFilter}
                      onSelect={onSelectPlayer}
                      favorite={user ? isFavorite(favoriteId) : false}
                      onToggleFavorite={user ? () => toggleFavorite(favoriteId, player.name) : null}
                    />
                  );
                })}
              </div>
            </motion.section>
          ))}
        </div>
      ) : hasFilters ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center">
          <p className="text-slate-300 font-semibold">No players match those filters</p>
          <button type="button" onClick={clearFilters} className="mt-2 text-sm text-amber-400 hover:text-amber-300">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center">
          <p className="text-slate-300 font-semibold">No player lines are posted right now</p>
          <p className="mt-1 text-sm text-slate-400">Use the search above to look up any player</p>
        </div>
      )}
    </div>
  );
}

export default FeaturedPlayers;
