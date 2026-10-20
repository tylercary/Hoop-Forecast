/**
 * Closing line snapshots.
 *
 * Hit rates need hundreds of picks before they say anything; whether the
 * market moved toward a pick shows within days. For every tracked, unevaluated
 * prediction whose game tips off within the next CLOSING_WINDOW_MINUTES
 * (default 20; a grace period after tip-off is the safety net for a run that
 * was missed), this job records on the record a `closing` object:
 *
 *   - the consensus closing line across non-DFS books and the market summary
 *     at that line (marketFeatureService.summarizeBooks, the same shape as the
 *     record's pick-time `market`): over_prob_novig, over/under consensus odds,
 *     n_books_priced, line_min/max/spread/mean, pinnacle_line
 *   - best_over / best_under: the best price for each side at that line
 *   - lines: no-vig over probability at every line a book prices, so CLV can
 *     be measured at the line the pick was first shown at even after the
 *     market moved
 *   - captured_at, minutes_to_tip
 *
 * Odds come from the shared event cache. If the cached event is older than
 * CLOSING_REFRESH_MAX_AGE_MS the event is refreshed once (one Odds API call per
 * game near tip-off, not per player). A record's `closing` is never
 * overwritten (predictionTrackingService.setClosingSnapshot), so the job is
 * idempotent and safe to run every few minutes.
 *
 * Grading: edgeGradingService reads `closing` next to the pick-time `market`
 * (and `first_prediction` when the record was revised) to compute line CLV,
 * price CLV and whether the pick beat the close.
 */

import { getAllPredictions, normalizeGameDate, setClosingSnapshot } from './predictionTrackingService.js';
import { getUpcomingEvents, getEventOdds, DFS_BOOKMAKERS } from './oddsEventCache.js';
import { summarizeBooks, mainLinePerBook, americanToProb } from './marketFeatureService.js';
import { teamNameMatchesAbbrev } from './teamMappingService.js';

const minutesEnv = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v * 60 * 1000 : fallback;
};

// Snapshot games tipping off within this window...
export const CLOSING_WINDOW_MS = minutesEnv('CLOSING_WINDOW_MINUTES', 20 * 60 * 1000);
// ...and, as a safety net, games that tipped off this recently without one
export const CLOSING_GRACE_MS = minutesEnv('CLOSING_GRACE_MINUTES', 20 * 60 * 1000);
// Cached odds older than this are refreshed before the snapshot
export const CLOSING_REFRESH_MAX_AGE_MS = minutesEnv('CLOSING_REFRESH_MAX_AGE_MINUTES', 15 * 60 * 1000);
// How often server.js runs the job
export const CLOSING_JOB_INTERVAL_MS = 5 * 60 * 1000;

const PROP_BY_MARKET = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes',
  player_points_rebounds_assists: 'pra',
  player_points_rebounds: 'pr',
  player_points_assists: 'pa',
  player_rebounds_assists: 'ra'
};

const round = (x, d = 4) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const playerKey = (name, prop) => `${(name || '').toLowerCase().trim()}|${prop}`;

/**
 * Every (book, line) a player's prop is posted at, from one event's raw
 * Odds API payload: "player|prop" -> [{ bookmaker_key, line, over_odds, under_odds }].
 * Alternate lines are kept (summarizeBooks picks each book's main line; the
 * per-line table needs the rest). A side the book does not price stays null.
 */
export function indexEventBooks(data) {
  const index = new Map();
  for (const bookmaker of data?.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const prop = PROP_BY_MARKET[market.key];
      if (!prop) continue;
      const byPlayerLine = new Map(); // "player|line" -> entry
      for (const outcome of market.outcomes || []) {
        const line = parseFloat(outcome.point);
        const side = (outcome.name || '').toLowerCase();
        if (!outcome.description || !Number.isFinite(line) || line <= 0) continue;
        if (side !== 'over' && side !== 'under') continue;
        const k = `${outcome.description}|${line}`;
        let entry = byPlayerLine.get(k);
        if (!entry) {
          entry = { player: outcome.description, bookmaker_key: bookmaker.key, line, over_odds: null, under_odds: null };
          byPlayerLine.set(k, entry);
        }
        const price = Number(outcome.price);
        if (Number.isFinite(price)) entry[side === 'over' ? 'over_odds' : 'under_odds'] = price;
      }
      for (const entry of byPlayerLine.values()) {
        const key = playerKey(entry.player, prop);
        if (!index.has(key)) index.set(key, []);
        const { player, ...book } = entry;
        index.get(key).push(book);
      }
    }
  }
  return index;
}

/** Most common main line across non-DFS books; ties go to the line nearest the mean, then the lower. */
export function consensusLine(books) {
  const main = mainLinePerBook(books).filter(b => !DFS_BOOKMAKERS.has(b.bookmaker_key));
  if (!main.length) return null;
  const counts = new Map();
  for (const b of main) counts.set(Number(b.line), (counts.get(Number(b.line)) || 0) + 1);
  const meanLine = main.reduce((s, b) => s + Number(b.line), 0) / main.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || Math.abs(a[0] - meanLine) - Math.abs(b[0] - meanLine) || a[0] - b[0])[0][0];
}

/** Best (highest) American price for a side at a line across non-DFS books. */
function bestPrice(books, side, line) {
  let best = null;
  for (const b of books) {
    if (DFS_BOOKMAKERS.has(b.bookmaker_key) || Math.abs(Number(b.line) - line) >= 0.01) continue;
    const odds = b[`${side}_odds`];
    if (odds == null) continue;
    if (!best || odds > best.odds) best = { bookmaker: b.bookmaker_key, line, odds };
  }
  return best;
}

/** No-vig over probability per line, from every non-DFS book pricing both sides of it. */
function noVigByLine(books) {
  const byLine = new Map();
  for (const b of books) {
    if (DFS_BOOKMAKERS.has(b.bookmaker_key)) continue;
    const po = americanToProb(b.over_odds);
    const pu = americanToProb(b.under_odds);
    if (po == null || pu == null) continue;
    const line = Number(b.line);
    if (!byLine.has(line)) byLine.set(line, { over: [], under: [] });
    byLine.get(line).over.push(po);
    byLine.get(line).under.push(pu);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, { over, under }]) => {
      const po = over.reduce((s, v) => s + v, 0) / over.length;
      const pu = under.reduce((s, v) => s + v, 0) / under.length;
      return { line, over_prob_novig: round(po / (po + pu)), n_books_priced: over.length };
    });
}

/**
 * The closing snapshot for one prop from its posted books.
 * @param {Array} books   [{ bookmaker_key, line, over_odds, under_odds }], all lines
 * @param {{ now?: number, tip?: number }} opts
 */
export function buildClosing(books, { now = Date.now(), tip = null } = {}) {
  if (!books?.length) return null;
  const line = consensusLine(books);
  if (!(line > 0)) return null;
  const summary = summarizeBooks(books, line, null);
  if (!summary) return null;
  return {
    ...summary,
    best_over: bestPrice(books, 'over', line),
    best_under: bestPrice(books, 'under', line),
    lines: noVigByLine(books),
    captured_at: new Date(now).toISOString(),
    minutes_to_tip: Number.isFinite(tip) ? Math.round((tip - now) / 60000) : null
  };
}

/**
 * Could this record describe the event's game? Same tip-off time (or same
 * date for rows stored without one), and when the record names its teams
 * they must be the event's. Several games share a tip-off time, so the
 * player's presence in the event's odds is the final word.
 */
function recordMatchesEvent(record, event) {
  const ng = record.next_game || {};
  const teams = [ng.team, ng.opponent].filter(Boolean);
  if (teams.length && !teams.every(t => teamNameMatchesAbbrev(event.home_team, t) || teamNameMatchesAbbrev(event.away_team, t))) return false;
  if (ng.commence_time) return new Date(ng.commence_time).getTime() === new Date(event.commence_time).getTime();
  const date = normalizeGameDate(ng.date);
  if (!date) return false;
  return date === event.commence_time.slice(0, 10) || date === normalizeGameDate(new Date(event.commence_time).toString());
}

/**
 * Snapshot the closing market for every tracked prediction near tip-off.
 * @returns {{ events: number, refreshed: number, snapshots: number, unmatched: number, candidates: number }}
 */
export async function runClosingSnapshots({ now = Date.now() } = {}) {
  const result = { events: 0, refreshed: 0, snapshots: 0, unmatched: 0, candidates: 0 };
  const pending = getAllPredictions().filter(p =>
    !p.evaluated && !p.expired && !p.dnp && !p.closing && p.betting_line > 0 && p.player_name && p.prop_type);
  if (!pending.length) return result;

  const events = (await getUpcomingEvents()).filter(e => {
    const tip = new Date(e.commence_time).getTime();
    return Number.isFinite(tip) && tip - now <= CLOSING_WINDOW_MS && now - tip <= CLOSING_GRACE_MS;
  });

  const done = new Set();
  const seen = new Set();
  for (const event of events) {
    const candidates = pending.filter(p => !done.has(p.id) && recordMatchesEvent(p, event));
    if (!candidates.length) continue;
    result.events++;
    for (const p of candidates) seen.add(p.id);
    const tip = new Date(event.commence_time).getTime();

    // One refresh per game at most; the player page and the 90-minute
    // background refresh may already have fresh data in the cache
    const data = await getEventOdds(event, { maxAgeMs: CLOSING_REFRESH_MAX_AGE_MS });
    if (!data?.bookmakers?.length) continue;
    const index = indexEventBooks(data);

    for (const record of candidates) {
      const books = index.get(playerKey(record.player_name, record.prop_type));
      if (!books) continue; // not in this game (or no book posts the prop)
      const closing = buildClosing(books, { now, tip });
      if (!closing) continue;
      if (setClosingSnapshot(record.id, closing)) result.snapshots++;
      done.add(record.id);
    }
  }
  result.candidates = seen.size;
  result.unmatched = seen.size - done.size;

  if (result.events) {
    console.log(`[Closing] ${result.snapshots} snapshots across ${result.events} games (${result.candidates} candidates, ${result.unmatched} without a priced line)`);
  }
  return result;
}

let jobInFlight = null;

/** Run the job unless a run is already in progress (interval-safe). */
export function runClosingSnapshotsOnce() {
  if (jobInFlight) return jobInFlight;
  jobInFlight = runClosingSnapshots()
    .catch(err => { console.error('[Closing] snapshot error:', err.message); return null; })
    .finally(() => { jobInFlight = null; });
  return jobInFlight;
}
