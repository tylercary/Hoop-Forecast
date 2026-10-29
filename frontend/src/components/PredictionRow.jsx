import { resolveImageUrl } from '../utils/api';

export const PROP_LABELS = {
  points: 'Points',
  assists: 'Assists',
  rebounds: 'Rebounds',
  threes: '3PM',
  threes_made: '3PM',
  steals: 'Steals',
  blocks: 'Blocks',
  turnovers: 'Turnovers',
  pra: 'PRA',
  pr: 'P+R',
  pa: 'P+A',
  ra: 'R+A',
  points_rebounds: 'P+R',
  points_assists: 'P+A',
  rebounds_assists: 'R+A',
  points_rebounds_assists: 'PRA',
};

export function propLabel(propType) {
  return PROP_LABELS[propType] || propType;
}

export function headshotUrl(playerName) {
  const slug = playerName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  return resolveImageUrl(`/images/players/${slug}.png`);
}

export function goToPlayer(navigate, { playerId, playerName }) {
  const nameSlug = encodeURIComponent(playerName.toLowerCase().replace(/\s+/g, '-'));
  navigate(`/player/${playerId}/${nameSlug}`, {
    state: {
      player: {
        id: playerId,
        first_name: playerName.split(' ')[0] || '',
        last_name: playerName.split(' ').slice(1).join(' ') || '',
      },
    },
  });
}

// gameDate is stored as YYYY-MM-DD; show it as "Oct 28" without a timezone shift.
export function shortDate(gameDate) {
  if (!gameDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameDate);
  if (!m) return gameDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const RESULT_STYLE = {
  win: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/15',
  loss: 'text-rose-400 border-rose-500/40 bg-rose-500/15',
  push: 'text-amber-400 border-amber-400/40 bg-amber-500/15',
  pending: 'text-slate-400 border-slate-600 bg-slate-700/40',
};

const RESULT_LABEL = { win: 'Win', loss: 'Loss', push: 'Push', pending: 'Pending' };

export function Avatar({ name, size = 'w-9 h-9', textSize = 'text-xs' }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2);
  return (
    <div className={`${size} flex-none relative`}>
      <img
        src={headshotUrl(name)}
        alt={name}
        loading="lazy"
        className={`${size} rounded-full object-cover bg-slate-700 ring-1 ring-slate-600`}
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.nextElementSibling.style.display = 'flex';
        }}
      />
      <div className={`hidden absolute inset-0 rounded-full bg-slate-700 ring-1 ring-slate-600 items-center justify-center`}>
        <span className={`text-slate-200 ${textSize} font-semibold`}>{initials}</span>
      </div>
    </div>
  );
}

/**
 * One prediction as a flat row for a divided list. `trailing` is an optional
 * node rendered after the status pill (used for the undo button).
 */
export default function PredictionRow({ pred, onClick, showWager = false, trailing = null }) {
  const status = pred.result || 'pending';
  const line = Number.parseFloat(pred.line);
  const meta = [
    propLabel(pred.propType),
    pred.opponent ? `vs ${pred.opponent}` : null,
    shortDate(pred.gameDate),
  ].filter(Boolean);

  let payout = null;
  if (showWager && pred.wager > 0 && pred.result) {
    if (pred.result === 'win') payout = { text: `+${pred.actualPayout || pred.wager}`, cls: 'text-emerald-400' };
    else if (pred.result === 'push') payout = { text: '±0', cls: 'text-amber-400' };
    else payout = { text: `−${pred.wager}`, cls: 'text-rose-400' };
  }

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex items-center gap-3 py-3 ${onClick ? 'cursor-pointer group' : ''}`}
    >
      <Avatar name={pred.playerName} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate group-hover:text-amber-300 transition-colors">
          {pred.playerName}
        </p>
        <p className="text-xs text-slate-400 truncate">
          {meta.join(' · ')}
          {showWager && pred.wager > 0 && (
            <span className="text-slate-500"> · {pred.wager} tokens</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-none">
        <span
          className={`text-sm font-semibold tabular-nums ${
            pred.pick === 'over' ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {pred.pick === 'over' ? 'Over' : 'Under'} {Number.isFinite(line) ? line.toFixed(1) : pred.line}
        </span>

        {pred.result && pred.actualValue != null && (
          <span className="hidden sm:inline text-xs text-slate-400 tabular-nums">
            got {Number.parseFloat(pred.actualValue).toFixed(1)}
          </span>
        )}

        {payout && <span className={`text-xs font-semibold tabular-nums ${payout.cls}`}>{payout.text}</span>}

        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${RESULT_STYLE[status]}`}>
          {RESULT_LABEL[status]}
        </span>

        {trailing}
      </div>
    </div>
  );
}
