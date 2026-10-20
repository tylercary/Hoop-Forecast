/**
 * Shared cache for The Odds API player-prop odds.
 *
 * Every caller (players-with-lines, trending, the player page, the batch
 * prediction cron, closing snapshots) reads from this module; nothing else in
 * the backend calls The Odds API. Each event's props are fetched once, for
 * every relevant sportsbook, and everyone reads from the result.
 *
 * Credits: a request costs (markets returned) x (region units), and every 10
 * named bookmakers count as one region unit. 16 books = 2 units, so one
 * refresh of a game is 8 markets x 2 = 16 credits on a 5M/month key.
 *
 * Spend is kept predictable three ways:
 *
 *  1. Tip-off-aware refresh. How often a game is refreshed in the background
 *     depends on how far away it is (REFRESH_SCHEDULE): every 3h when the game
 *     is more than a day out, tightening to every 5 min in the last hour and
 *     every 2 min in the last 15 min, so the closing snapshot reads a market
 *     that is as close to the true close as possible. A refresh loop
 *     (startOddsRefreshLoop, from server.js) walks the slate every minute and
 *     refreshes whatever is past its floor, so the schedule is kept whether or
 *     not anyone is browsing. After tip-off the props are off the board, so the
 *     event is never refreshed again and the last snapshot is served. The
 *     player page may read the single game it shows fresher than the schedule
 *     ({ view: true }: 3 min within 6h of tip, 10 min otherwise); background
 *     callers can never go below the schedule's floor.
 *
 *  2. Restart-safe. Events, per-event odds, usage and the spend history are
 *     written to DATA_DIR/odds_cache.json (debounced) and loaded at startup,
 *     so a deploy only refetches what the schedule says is stale.
 *
 *  3. Daily budget. Credits are summed per day (rolling over at 08:00 UTC, so
 *     an NBA night is one day) from the x-requests-last header. Past
 *     ODDS_DAILY_BUDGET (default 120,000, about 70% of a 5M/month key spread
 *     over 30 days) background refreshes stop;
 *     a user viewing a game within an hour of tip-off still gets a refresh,
 *     everything else is served stale. /api/health shows the budget state and
 *     the last 14 days of spend.
 *
 * Also kept: in-flight dedupe (concurrent callers share one request),
 * stale-on-error, and a 15-minute backoff after a quota/auth error.
 *
 * Line moves: when a refresh of a game within LINE_MOVE_WINDOW_MS (6h) of tip
 * changes a player's consensus line, or a prop appears or disappears, the
 * 'lines-changed' listeners (onLinesChanged) get the diff so the batch
 * predictor can re-run just those players instead of waiting for the slate.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const API_BASE = 'https://api.the-odds-api.com/v4';

// US sportsbooks and DFS pick'em sites that post NBA player props, plus
// Pinnacle as a sharp reference. (us + us2 + us_dfs regions; the exchanges
// in us_ex and the AU/UK books are left out as irrelevant to US bettors.)
export const BOOKMAKERS = [
  'fanduel', 'draftkings', 'betmgm', 'williamhill_us', 'betrivers', 'fanatics',
  'espnbet', 'hardrockbet', 'betparx', 'ballybet', 'bovada', 'betonlineag',
  'prizepicks', 'underdog', 'pick6',
  'pinnacle'
];

// Pick'em sites: real lines, but fixed symmetric prices rather than market odds
export const DFS_BOOKMAKERS = new Set(['prizepicks', 'underdog', 'pick6']);

export const PROP_MARKETS = [
  'player_points', 'player_rebounds', 'player_assists', 'player_threes',
  'player_points_rebounds_assists', 'player_points_rebounds',
  'player_points_assists', 'player_rebounds_assists'
];

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Background refresh floor by time to tip-off: the first row whose `within`
 * (ms until tip) covers the event applies. Past tip-off nothing refreshes.
 */
export const REFRESH_SCHEDULE = [
  { within: 15 * MIN, every: 2 * MIN },    // last 15 min: the closing market
  { within: 1 * HOUR, every: 5 * MIN },    // last hour
  { within: 2 * HOUR, every: 10 * MIN },   // 1-2h out
  { within: 6 * HOUR, every: 20 * MIN },   // 2-6h out
  { within: 24 * HOUR, every: 60 * MIN },  // 6-24h out
  { within: Infinity, every: 3 * HOUR }    // more than a day out
];
// The game a user is looking at may be read fresher than the schedule
export const VIEW_MAX_AGE = { nearWithin: 6 * HOUR, near: 3 * MIN, far: 10 * MIN };
// How often the refresh loop walks the slate
export const REFRESH_LOOP_INTERVAL_MS = 1 * MIN;
// Refreshes of games this close to tip-off report line moves to onLinesChanged
export const LINE_MOVE_WINDOW_MS = 6 * HOUR;
// While the budget is exhausted, only views of games this close to tip-off refresh
export const PAUSED_VIEW_WINDOW_MS = 1 * HOUR;
const EVENTS_TTL_MS = 10 * MIN;
// Events within this window of the first upcoming game are shown (roughly
// tonight's slate plus tomorrow's early games), capped to bound credit use
const SLATE_WINDOW_MS = 36 * HOUR;
const MAX_EVENTS = 14;
const FETCH_CONCURRENCY = 3;
// After a quota/auth error, stop calling the API for a while and serve stale data
const QUOTA_BACKOFF_MS = 15 * MIN;

const DAILY_BUDGET = (() => {
  const v = Number(process.env.ODDS_DAILY_BUDGET);
  return Number.isFinite(v) && v > 0 ? v : 120000;
})();
const SPEND_HISTORY_DAYS = 14;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'odds_cache.json');
const SAVE_DEBOUNCE_MS = 1500;
const CACHE_FILE_VERSION = 1;

const HEADERS = { 'User-Agent': 'HoopForecast/2.0' };

let eventsCache = { events: [], fetchedAt: 0 };
const oddsCache = new Map();     // eventId -> { event, data, fetchedAt }
const inFlight = new Map();      // eventId -> Promise
let eventsInFlight = null;       // Promise while the events list is being fetched
let quotaBlockedUntil = 0;
const usage = { remaining: null, used: null, lastCost: null, updatedAt: null, blockedUntil: null };
// 'YYYY-MM-DD' (UTC) -> credits spent that day by this backend
let spendByDay = {};

// ---------------------------------------------------------------------------
// Schedule helpers (pure; unit-tested in tests/oddsEventCache.test.js)
// ---------------------------------------------------------------------------

const tipTime = (event) => {
  const t = new Date(event?.commence_time).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Background refresh floor for an event at `now`: the schedule's interval for
 * its time to tip-off, or Infinity once it has tipped off (never refresh).
 * An event with no usable tip time is treated as far away.
 */
export function refreshFloorMs(event, now = Date.now()) {
  const tip = tipTime(event);
  if (tip == null) return REFRESH_SCHEDULE[REFRESH_SCHEDULE.length - 1].every;
  const untilTip = tip - now;
  if (untilTip <= 0) return Infinity;
  return REFRESH_SCHEDULE.find(r => untilTip <= r.within).every;
}

/** Max age for the game a user is viewing: tighter as tip-off nears. */
export function viewMaxAgeMs(event, now = Date.now()) {
  const tip = tipTime(event);
  return tip != null && tip - now <= VIEW_MAX_AGE.nearWithin ? VIEW_MAX_AGE.near : VIEW_MAX_AGE.far;
}

// Budget days roll over at 08:00 UTC (3-4am Eastern), so a whole NBA night,
// West-coast late games included, lands in one day's spend.
export const DAY_ROLLOVER_UTC_HOURS = 8;
export const dayKey = (now = Date.now()) => new Date(now - DAY_ROLLOVER_UTC_HOURS * HOUR).toISOString().slice(0, 10);

/**
 * Decide what getEventOdds should do for one event, given the cache state.
 * maxAgeMs 0 (the default) means the schedule's floor for background callers
 * and viewMaxAgeMs for views; a larger value only ever loosens that.
 * Returns { action: 'cached' | 'fetch' | 'stale', reason, maxAgeMs }.
 *   cached: a copy young enough for this caller exists
 *   fetch:  call the API
 *   stale:  do not call the API; serve whatever is cached (maybe nothing)
 */
export function planRefresh(event, cached, {
  maxAgeMs = 0,
  view = false,
  now = Date.now(),
  quotaBlockedUntil: blockedUntil = 0,
  paused = false
} = {}) {
  const floor = refreshFloorMs(event, now);
  const age = cached ? now - cached.fetchedAt : Infinity;

  if (floor === Infinity) return { action: cached ? 'cached' : 'stale', reason: 'tipped-off', maxAgeMs: floor };

  // Views may read fresher than the schedule; background work never does.
  // maxAgeMs = 0 means "whatever the schedule says".
  const effectiveMaxAge = view ? (maxAgeMs || viewMaxAgeMs(event, now)) : Math.max(maxAgeMs, floor);
  if (cached && age < effectiveMaxAge) return { action: 'cached', reason: 'fresh', maxAgeMs: effectiveMaxAge };
  if (now < blockedUntil) return { action: 'stale', reason: 'quota-backoff', maxAgeMs: effectiveMaxAge };
  if (paused) {
    const tip = tipTime(event);
    const nearTip = tip != null && tip - now <= PAUSED_VIEW_WINDOW_MS;
    if (!(view && nearTip)) return { action: 'stale', reason: 'budget-paused', maxAgeMs: effectiveMaxAge };
  }
  return { action: 'fetch', reason: cached ? 'expired' : 'uncached', maxAgeMs: effectiveMaxAge };
}

// ---------------------------------------------------------------------------
// Usage, budget and persistence
// ---------------------------------------------------------------------------

function pruneSpend(now = Date.now()) {
  const keep = new Set();
  for (let i = 0; i < SPEND_HISTORY_DAYS; i++) keep.add(dayKey(now - i * 24 * HOUR));
  for (const day of Object.keys(spendByDay)) if (!keep.has(day)) delete spendByDay[day];
}

function spentToday(now = Date.now()) {
  return spendByDay[dayKey(now)] || 0;
}

export function isBudgetPaused(now = Date.now()) {
  return spentToday(now) >= DAILY_BUDGET;
}

function recordUsage(headers, now = Date.now()) {
  if (!headers) return;
  const num = (v) => (v == null ? null : Number(v));
  if (headers['x-requests-remaining'] != null) usage.remaining = num(headers['x-requests-remaining']);
  if (headers['x-requests-used'] != null) usage.used = num(headers['x-requests-used']);
  if (headers['x-requests-last'] != null) {
    const cost = num(headers['x-requests-last']);
    usage.lastCost = cost;
    if (Number.isFinite(cost) && cost > 0) {
      const wasPaused = isBudgetPaused(now);
      const day = dayKey(now);
      spendByDay[day] = (spendByDay[day] || 0) + cost;
      pruneSpend(now);
      if (!wasPaused && isBudgetPaused(now)) {
        console.warn(`[OddsCache] daily budget reached: ${spendByDay[day]}/${DAILY_BUDGET} credits on ${day}; background refreshes paused until the day rolls over at 08:00 UTC`);
      }
    }
  }
  usage.updatedAt = new Date(now).toISOString();
  scheduleSave();
}

function isQuotaError(err) {
  const status = err.response?.status;
  const code = err.response?.data?.error_code;
  return status === 401 || status === 403 || code === 'OUT_OF_USAGE_CREDITS';
}

function blockForQuota(err) {
  quotaBlockedUntil = Date.now() + QUOTA_BACKOFF_MS;
  usage.blockedUntil = new Date(quotaBlockedUntil).toISOString();
  console.error(`Odds API quota/auth error (${err.response?.status}); pausing calls for 15 min`);
}

/** Spend per UTC day, oldest first, for the last SPEND_HISTORY_DAYS days with any spend. */
export function getSpendHistory() {
  return Object.entries(spendByDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, credits]) => ({ day, credits }));
}

/** Credit usage (API headers), budget state and spend history (for /api/health). */
export function getOddsApiUsage() {
  const now = Date.now();
  return {
    ...usage,
    cachedEvents: oddsCache.size,
    bookmakers: BOOKMAKERS.length,
    budget: {
      daily_budget: DAILY_BUDGET,
      spent_today: spentToday(now),
      paused: isBudgetPaused(now),
      day: dayKey(now)
    },
    spendHistory: getSpendHistory()
  };
}

let saveTimer = null;
let dirty = false;

function serialize() {
  return JSON.stringify({
    version: CACHE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    events: eventsCache,
    odds: Object.fromEntries(oddsCache),
    usage,
    spendByDay
  });
}

function saveNow() {
  dirty = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, serialize());
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.error('[OddsCache] could not write odds_cache.json:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

// predictionTrackingService exits the process on SIGINT/SIGTERM; 'exit'
// handlers run synchronously on the way out, so a pending save is not lost.
process.on('exit', () => { if (dirty) saveNow(); });

function loadFromDisk() {
  let raw;
  try {
    raw = fs.readFileSync(CACHE_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[OddsCache] could not read odds_cache.json:', err.message);
    return;
  }
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== CACHE_FILE_VERSION) return;
    if (Array.isArray(saved.events?.events)) eventsCache = { events: saved.events.events, fetchedAt: Number(saved.events.fetchedAt) || 0 };
    for (const [id, entry] of Object.entries(saved.odds || {})) {
      if (entry?.event?.id && entry.data && Number.isFinite(entry.fetchedAt)) oddsCache.set(id, entry);
    }
    if (saved.usage) Object.assign(usage, saved.usage);
    usage.blockedUntil = null;
    if (saved.spendByDay && typeof saved.spendByDay === 'object') spendByDay = { ...saved.spendByDay };
    pruneSpend();
    const ages = [...oddsCache.values()].map(e => Date.now() - e.fetchedAt);
    const newest = ages.length ? Math.round(Math.min(...ages) / MIN) : null;
    console.log(`[OddsCache] loaded ${eventsCache.events.length} events and odds for ${oddsCache.size} games from odds_cache.json` +
      (newest != null ? ` (newest ${newest} min old)` : '') +
      `; spent today ${spentToday()}/${DAILY_BUDGET} credits`);
  } catch (err) {
    console.error('[OddsCache] odds_cache.json unreadable, starting empty:', err.message);
  }
}

loadFromDisk();

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Upcoming events for the current slate: games within 36h of the first
 * upcoming game, capped. The events endpoint is (nearly) free.
 */
export async function getUpcomingEvents() {
  if (!API_KEY) return [];
  const age = Date.now() - eventsCache.fetchedAt;
  if (eventsCache.events.length && age < EVENTS_TTL_MS) return eventsCache.events;
  if (Date.now() < quotaBlockedUntil) return eventsCache.events;
  if (eventsInFlight) return eventsInFlight;
  eventsInFlight = fetchUpcomingEvents().finally(() => { eventsInFlight = null; });
  return eventsInFlight;
}

async function fetchUpcomingEvents() {
  try {
    const res = await axios.get(`${API_BASE}/sports/basketball_nba/events`, {
      params: { apiKey: API_KEY },
      headers: HEADERS,
      timeout: 15000
    });
    recordUsage(res.headers);
    const all = Array.isArray(res.data) ? res.data : [];
    all.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
    const firstStart = all.length ? new Date(all[0].commence_time).getTime() : 0;
    const events = all
      .filter(e => new Date(e.commence_time).getTime() - firstStart < SLATE_WINDOW_MS)
      .slice(0, MAX_EVENTS);
    eventsCache = { events, fetchedAt: Date.now() };

    // Drop odds for games no longer in the slate
    const keep = new Set(events.map(e => e.id));
    for (const id of oddsCache.keys()) if (!keep.has(id)) oddsCache.delete(id);
    console.log(`[OddsCache] events list refreshed: ${events.length} games in the slate (cost ${usage.lastCost ?? '?'}, remaining ${usage.remaining ?? '?'})`);
    scheduleSave();
    return events;
  } catch (err) {
    if (isQuotaError(err)) blockForQuota(err);
    else console.error('Odds API events error:', err.message);
    return eventsCache.events;
  }
}

// ---------------------------------------------------------------------------
// Per-event odds
// ---------------------------------------------------------------------------

async function upcomingUnstartedEvents() {
  const now = Date.now();
  return (await getUpcomingEvents()).filter(e => {
    const tip = tipTime(e);
    return tip == null || tip > now;
  });
}

/** Cached odds for one event, or null. Never calls the API. */
export function getCachedEventOdds(eventId) {
  return oddsCache.get(eventId)?.data || null;
}

const fmtDuration = (ms) => {
  if (!Number.isFinite(ms)) return 'never';
  const sign = ms < 0 ? '-' : '';
  const m = Math.round(Math.abs(ms) / MIN);
  return m >= 60 ? `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${sign}${m}m`;
};

async function fetchEventOdds(event) {
  const res = await axios.get(`${API_BASE}/sports/basketball_nba/events/${event.id}/odds`, {
    params: {
      apiKey: API_KEY,
      bookmakers: BOOKMAKERS.join(','),
      markets: PROP_MARKETS.join(','),
      oddsFormat: 'american'
    },
    headers: HEADERS,
    timeout: 15000
  });
  recordUsage(res.headers);
  return res.data;
}

/**
 * Odds for one event (all prop markets, all bookmakers).
 *
 * @param {object} event   an event from getUpcomingEvents (id, commence_time, teams)
 * @param {object} opts
 * @param {number} opts.maxAgeMs  serve cached data younger than this; 0 (the
 *   default) means the tip-off schedule's floor. Background callers are held to
 *   the floor whatever they pass.
 * @param {boolean} opts.view     the game a user is looking at right now: may
 *   read fresher than the schedule (viewMaxAgeMs, or maxAgeMs when given), and
 *   is the only caller still refreshed while the daily budget is exhausted
 *   (within 1h of tip).
 *
 * Concurrent callers share one request. Returns stale data rather than
 * nothing when the API fails or calls are paused, and never calls the API
 * for a game that has tipped off.
 */
export async function getEventOdds(event, { maxAgeMs = 0, view = false } = {}) {
  if (!API_KEY || !event?.id) return null;
  const now = Date.now();
  const cached = oddsCache.get(event.id);
  const plan = planRefresh(event, cached, { maxAgeMs, view, now, quotaBlockedUntil, paused: isBudgetPaused(now) });
  if (plan.action !== 'fetch') return cached?.data || null;
  if (inFlight.has(event.id)) return inFlight.get(event.id);

  const label = `${event.away_team} @ ${event.home_team}`;
  const request = fetchEventOdds(event)
    .then(data => {
      oddsCache.set(event.id, { event, data, fetchedAt: Date.now() });
      scheduleSave();
      const tip = tipTime(event);
      if (cached && tip != null && tip - now <= LINE_MOVE_WINDOW_MS) emitLineChanges(event, cached.data, data);
      console.log(`[OddsCache] refreshed ${label} (${plan.reason}${view ? ', view' : ''}; tip in ${fmtDuration(tip - now)}, floor ${fmtDuration(refreshFloorMs(event, now))}; ` +
        `cost ${usage.lastCost ?? '?'}, today ${spentToday()}/${DAILY_BUDGET}, remaining ${usage.remaining ?? '?'})`);
      return data;
    })
    .catch(err => {
      if (isQuotaError(err)) blockForQuota(err);
      else console.error(`Odds API error for ${label}:`, err.message);
      return cached?.data || null;
    })
    .finally(() => inFlight.delete(event.id));

  inFlight.set(event.id, request);
  return request;
}

/**
 * Odds for every event in the current slate that has not tipped off, as
 * [{ event, data }]. Each event is refreshed only when the tip-off schedule
 * (or a tighter maxAgeMs, never below the schedule) says it is stale. Fetches
 * a few events at a time to stay clear of the API's rate limit.
 */
export async function getAllEventOdds({ maxAgeMs = 0 } = {}) {
  const events = await upcomingUnstartedEvents();
  const results = new Array(events.length);
  let next = 0;

  async function worker() {
    while (next < events.length) {
      const index = next++;
      const event = events[index];
      const data = await getEventOdds(event, { maxAgeMs });
      results[index] = { event, data };
    }
  }

  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, events.length) }, worker));
  return results.filter(r => r?.data?.bookmakers?.length);
}

// ---------------------------------------------------------------------------
// Background refresh loop
// ---------------------------------------------------------------------------

let refreshLoop = null;
let refreshTickInFlight = null;

/**
 * One pass over the slate: refresh every unstarted game whose cached odds are
 * older than its schedule floor (getEventOdds decides; budget pause, quota
 * backoff and in-flight dedupe all apply). Safe to call at any time.
 */
export async function refreshSlateOnce() {
  if (!API_KEY) return 0;
  if (refreshTickInFlight) return refreshTickInFlight;
  refreshTickInFlight = (async () => {
    const before = usage.used;
    await getAllEventOdds();
    return usage.used != null && before != null ? usage.used - before : 0;
  })()
    .catch(err => { console.error('[OddsCache] refresh loop error:', err.message); return 0; })
    .finally(() => { refreshTickInFlight = null; });
  return refreshTickInFlight;
}

/**
 * Keep the slate on schedule whether or not anyone is browsing: walk it every
 * REFRESH_LOOP_INTERVAL_MS. Called once from server.js; a second call is a no-op.
 */
export function startOddsRefreshLoop({ intervalMs = REFRESH_LOOP_INTERVAL_MS, initialDelayMs = 5000 } = {}) {
  if (refreshLoop || !API_KEY) return;
  const first = setTimeout(() => { refreshSlateOnce(); }, initialDelayMs);
  first.unref?.();
  refreshLoop = setInterval(() => { refreshSlateOnce(); }, intervalMs);
  refreshLoop.unref?.();
  console.log(`[OddsCache] refresh loop started (every ${Math.round(intervalMs / 1000)}s; floors ${REFRESH_SCHEDULE.map(r => `${fmtDuration(r.every)} within ${fmtDuration(r.within)}`).join(', ')})`);
}

/** Stop the refresh loop (tests). */
export function stopOddsRefreshLoop() {
  if (refreshLoop) clearInterval(refreshLoop);
  refreshLoop = null;
}

// ---------------------------------------------------------------------------
// Line-move detection
// ---------------------------------------------------------------------------

export const PROP_BY_MARKET = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes',
  player_points_rebounds_assists: 'pra',
  player_points_rebounds: 'pr',
  player_points_assists: 'pa',
  player_rebounds_assists: 'ra'
};

const impliedProb = (odds) => {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
};

/**
 * Consensus main line per player-prop from one event's raw Odds API payload:
 * "player|prop" -> { player, prop, line }. Each non-DFS book's main line is the
 * one priced nearest to even on both sides (alternates are further off), and
 * the consensus is the most common main line across books (ties: nearest the
 * mean, then the lower). DFS pick'em sites only count when no sportsbook
 * posts the prop.
 */
export function consensusLines(data) {
  // key -> Map(book -> { line, offEven })
  const perBook = new Map();
  for (const bookmaker of data?.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const prop = PROP_BY_MARKET[market.key];
      if (!prop) continue;
      const byPlayerLine = new Map(); // "player|line" -> { player, line, over, under }
      for (const outcome of market.outcomes || []) {
        const line = parseFloat(outcome.point);
        const side = (outcome.name || '').toLowerCase();
        if (!outcome.description || !Number.isFinite(line) || line <= 0) continue;
        if (side !== 'over' && side !== 'under') continue;
        const k = `${outcome.description}|${line}`;
        const entry = byPlayerLine.get(k) || { player: outcome.description, line, over: null, under: null };
        entry[side] = impliedProb(outcome.price);
        byPlayerLine.set(k, entry);
      }
      for (const e of byPlayerLine.values()) {
        const key = `${e.player.toLowerCase().trim()}|${prop}`;
        const offEven = e.over == null || e.under == null ? 1 : Math.abs(e.over - 0.5) + Math.abs(e.under - 0.5);
        if (!perBook.has(key)) perBook.set(key, { player: e.player, prop, books: new Map() });
        const books = perBook.get(key).books;
        const cur = books.get(bookmaker.key);
        if (!cur || offEven < cur.offEven) books.set(bookmaker.key, { line: e.line, offEven });
      }
    }
  }

  const result = new Map();
  for (const [key, { player, prop, books }] of perBook) {
    let mains = [...books.entries()].filter(([book]) => !DFS_BOOKMAKERS.has(book)).map(([, b]) => b.line);
    if (!mains.length) mains = [...books.values()].map(b => b.line);
    const counts = new Map();
    for (const line of mains) counts.set(line, (counts.get(line) || 0) + 1);
    const mean = mains.reduce((s, l) => s + l, 0) / mains.length;
    const line = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || Math.abs(a[0] - mean) - Math.abs(b[0] - mean) || a[0] - b[0])[0][0];
    result.set(key, { player, prop, line });
  }
  return result;
}

/**
 * What changed between two payloads of the same event:
 * [{ player, prop, oldLine, newLine }], with null for a prop that was not
 * posted on that side. Empty when nothing moved.
 */
export function diffEventLines(oldData, newData) {
  const before = consensusLines(oldData);
  const after = consensusLines(newData);
  const changes = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) changes.push({ player: b.player, prop: b.prop, oldLine: b.line, newLine: null });
    else if (Math.abs(a.line - b.line) >= 0.01) changes.push({ player: a.player, prop: a.prop, oldLine: b.line, newLine: a.line });
  }
  for (const [key, a] of after) {
    if (!before.has(key)) changes.push({ player: a.player, prop: a.prop, oldLine: null, newLine: a.line });
  }
  return changes;
}

const lineListeners = new Set();

/**
 * Subscribe to line moves: fn({ event, changes }) after a refresh of a game
 * within LINE_MOVE_WINDOW_MS of tip-off changed at least one consensus line
 * (changes as in diffEventLines). Returns an unsubscribe function.
 */
export function onLinesChanged(fn) {
  lineListeners.add(fn);
  return () => lineListeners.delete(fn);
}

function emitLineChanges(event, oldData, newData) {
  let changes;
  try {
    changes = diffEventLines(oldData, newData);
  } catch (err) {
    console.warn('[OddsCache] line diff failed:', err.message);
    return;
  }
  if (!changes.length) return;
  const players = new Set(changes.map(c => c.player)).size;
  console.log(`[OddsCache] ${changes.length} line changes across ${players} players for ${event.away_team} @ ${event.home_team}`);
  for (const fn of lineListeners) {
    try { fn({ event, changes }); } catch (err) { console.warn('[OddsCache] lines-changed listener failed:', err.message); }
  }
}
