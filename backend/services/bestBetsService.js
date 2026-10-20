/**
 * Best Bets: the slate's props where the edge model disagrees with the line
 * by a meaningful margin.
 *
 * The edge model's out-of-sample edge grows with its disagreement from the
 * line (55% sign accuracy at 0.5+ disagreement, 59% at 1.0+, 68% at 2.0+;
 * break-even at -110 is 52.4%), so the home page leads with the concentrated
 * part of that edge: tracked predictions for games tipping off in the next 36
 * hours whose residual or over-probability clears the pick thresholds.
 *
 * Reads only the in-memory prediction store and the shared odds cache; never
 * calls the Odds API on its own.
 */
import { getAllPredictions, normalizeGameDate } from './predictionTrackingService.js';
import { getAllEventOdds, DFS_BOOKMAKERS } from './oddsEventCache.js';
import { ensureSlatePredicted } from './batchPredictionCron.js';
import { getTeamAbbrevFromFullName } from './teamMappingService.js';

export const THRESHOLDS = {
  // Pick thresholds in unifiedPredictionService: OVER at >= 56, UNDER at <= 44
  over_probability_min: 56,
  under_probability_max: 44,
  // Projection at least this far from the line (edge_residual is capped there)
  min_abs_edge_residual: 1.0,
  window_hours: 36
};

export const MAX_ROWS = 25;
// Below this many upcoming tracked rows the slate is treated as unpredicted
export const MIN_SLATE_ROWS = 20;

const PROP_MARKET_KEYS = {
  points: 'player_points',
  rebounds: 'player_rebounds',
  assists: 'player_assists',
  threes: 'player_threes',
  pra: 'player_points_rebounds_assists',
  pr: 'player_points_rebounds',
  pa: 'player_points_assists',
  ra: 'player_rebounds_assists'
};

function playerKey(p) {
  return `${(p.player_name || '').toLowerCase()}|${p.prop_type}`;
}

/**
 * Tip-off for a record: the stored commence_time, or (for rows stored before
 * the batch kept it) the cached event the player's prop is listed in, when
 * that event falls on the record's game date.
 */
function tipOff(p, oddsIndex) {
  const stored = p.next_game?.commence_time;
  if (stored) return new Date(stored).getTime();
  const event = oddsIndex.get(playerKey(p))?.event;
  if (!event?.commence_time) return NaN;
  const date = p.next_game?.date;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !event.commence_time.startsWith(date)) return NaN;
  return new Date(event.commence_time).getTime();
}

/** Tracked, unevaluated predictions for games tipping off within the window. */
export function upcomingPredictions(oddsIndex = new Map(), now = Date.now(), windowHours = THRESHOLDS.window_hours) {
  const horizon = now + windowHours * 60 * 60 * 1000;
  return getAllPredictions()
    .filter(p => !p.evaluated && !p.expired && !p.dnp)
    .map(p => ({ record: p, tip: tipOff(p, oddsIndex) }))
    .filter(({ tip }) => Number.isFinite(tip) && tip > now && tip <= horizon);
}

function clearsThreshold(p) {
  const prob = Number(p.over_probability);
  const residual = Number(p.edge_residual);
  return (Number.isFinite(residual) && Math.abs(residual) >= THRESHOLDS.min_abs_edge_residual)
    || (Number.isFinite(prob) && (prob >= THRESHOLDS.over_probability_min || prob <= THRESHOLDS.under_probability_max));
}

/**
 * Side of the line the model takes: the pick when there is one, otherwise the
 * lean, which always follows the projection's side of the line.
 */
function sideOf(p) {
  if (p.recommendation === 'OVER') return { side: 'over', pick: true };
  if (p.recommendation === 'UNDER') return { side: 'under', pick: true };
  const projection = Number(p.predicted_value);
  const line = Number(p.betting_line);
  if (Number.isFinite(projection) && Number.isFinite(line) && projection !== line) {
    return { side: projection > line ? 'over' : 'under', pick: false };
  }
  return { side: Number(p.over_probability) >= 50 ? 'over' : 'under', pick: false };
}

/**
 * Index the cached odds by player and prop: every non-DFS book's price for
 * each side and line, plus the event the player is in.
 */
function indexOdds(eventOdds) {
  const index = new Map(); // "player|propType" -> { event, prices: [{ book, side, line, price }] }
  const propByMarket = Object.fromEntries(Object.entries(PROP_MARKET_KEYS).map(([k, v]) => [v, k]));

  for (const { event, data } of eventOdds) {
    for (const bookmaker of data?.bookmakers || []) {
      if (DFS_BOOKMAKERS.has(bookmaker.key)) continue;
      for (const market of bookmaker.markets || []) {
        const propType = propByMarket[market.key];
        if (!propType) continue;
        for (const outcome of market.outcomes || []) {
          const line = parseFloat(outcome.point);
          const price = Number(outcome.price);
          const side = (outcome.name || '').toLowerCase();
          if (!outcome.description || !Number.isFinite(line) || !Number.isFinite(price)) continue;
          if (side !== 'over' && side !== 'under') continue;
          const key = `${outcome.description.toLowerCase()}|${propType}`;
          let entry = index.get(key);
          if (!entry) {
            entry = { event, prices: [] };
            index.set(key, entry);
          }
          entry.prices.push({ book: bookmaker.title || bookmaker.key, key: bookmaker.key, side, line, price });
        }
      }
    }
  }
  return index;
}

/** Best American price for a side at this line across non-DFS books. */
function bestPrice(entry, side, line) {
  if (!entry) return null;
  let best = null;
  for (const q of entry.prices) {
    if (q.side !== side || Math.abs(q.line - line) >= 0.1) continue;
    // American odds compare directly: +120 beats -105 beats -115
    if (!best || q.price > best.odds) best = { sportsbook: q.key, book: q.book, odds: q.price };
  }
  return best;
}

/**
 * Select the slate's best bets from the store. Pure apart from the odds cache
 * read; the route adds images and caching.
 */
export async function selectBestBets({ now = Date.now() } = {}) {
  let oddsIndex = new Map();
  try {
    oddsIndex = indexOdds(await getAllEventOdds());
  } catch (err) {
    console.warn('[BestBets] odds cache unavailable:', err.message);
  }

  const upcoming = upcomingPredictions(oddsIndex, now);

  // One row per player/prop/game, keeping the newest
  const latest = new Map();
  for (const { record: p, tip } of upcoming) {
    if (p.model_variant !== 'edge') continue;
    if (!Number.isFinite(Number(p.betting_line))) continue;
    const key = `${playerKey(p)}|${normalizeGameDate(p.next_game?.date)}`;
    const prev = latest.get(key);
    const stamp = (r) => new Date(r.updated_at || r.created_at);
    if (!prev || stamp(p) > stamp(prev.record)) latest.set(key, { record: p, tip });
  }

  const candidates = [...latest.values()].filter(({ record }) => clearsThreshold(record));
  candidates.sort((a, b) => Math.abs(b.record.over_probability - 50) - Math.abs(a.record.over_probability - 50));
  const top = candidates.slice(0, MAX_ROWS);

  const rows = top.map(({ record: p, tip }) => {
    const { side, pick } = sideOf(p);
    const line = Number(p.betting_line);
    const game = p.next_game || {};
    const entry = oddsIndex.get(playerKey(p));
    const event = entry?.event;
    // Teams from the record, else from the cached event
    const team = game.team || null;
    const opponent = game.opponent || null;
    const is_home = game.is_home ?? null;
    let home_team = is_home == null ? null : (is_home ? team : opponent);
    let away_team = is_home == null ? null : (is_home ? opponent : team);
    if ((!home_team || !away_team) && event) {
      home_team = getTeamAbbrevFromFullName(event.home_team) || event.home_team;
      away_team = getTeamAbbrevFromFullName(event.away_team) || event.away_team;
    }
    const prob = Number(p.over_probability);
    return {
      player: p.player_name,
      team,
      opponent,
      is_home,
      home_team: home_team || null,
      away_team: away_team || null,
      game_date: game.date || null,
      commence_time: new Date(tip).toISOString(),
      event_id: event?.id || null,
      prop_type: p.prop_type,
      line,
      side,
      pick,
      over_probability: Number.isFinite(prob) ? Math.round(prob * 10) / 10 : null,
      side_probability: Number.isFinite(prob) ? Math.round((side === 'over' ? prob : 100 - prob) * 10) / 10 : null,
      projection: Number.isFinite(Number(p.predicted_value)) ? Math.round(Number(p.predicted_value) * 10) / 10 : null,
      model_value: Number.isFinite(Number(p.model_value)) ? Math.round(Number(p.model_value) * 10) / 10 : null,
      edge_residual: Number.isFinite(Number(p.edge_residual)) ? Math.round(Number(p.edge_residual) * 100) / 100 : null,
      confidence: p.confidence || null,
      best_price: bestPrice(entry, side, line),
      player_image: null
    };
  });

  return { rows, upcoming_rows: upcoming.length };
}

/**
 * Best bets for the slate. When the store holds too few upcoming rows (fresh
 * deploy, or the batch run has not reached today's games yet), kick off the
 * guarded slate prediction in the background and report `warming` so the
 * caller caches the thin answer only briefly.
 */
export async function getBestBets() {
  let { rows, upcoming_rows } = await selectBestBets();
  let warming = false;

  if (upcoming_rows < MIN_SLATE_ROWS) {
    const run = ensureSlatePredicted();
    // Give a run that is already finishing a moment, otherwise answer now
    const settled = await Promise.race([run.then(() => true), new Promise(r => setTimeout(() => r(false), 1500))]);
    if (settled) ({ rows, upcoming_rows } = await selectBestBets());
    else warming = true;
    run.catch(err => console.error('[BestBets] slate prediction failed:', err.message));
  }

  return {
    generated_at: new Date().toISOString(),
    thresholds: THRESHOLDS,
    warming,
    upcoming_rows,
    count: rows.length,
    picks: rows
  };
}
