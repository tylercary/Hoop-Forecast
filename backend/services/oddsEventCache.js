/**
 * Shared cache for The Odds API player-prop odds.
 *
 * Every caller (players-with-lines, trending, the player page, the batch
 * prediction cron) used to call the API on its own, so the same 8 markets
 * for the same 10 games were fetched over and over. This module fetches each
 * event's props once, for every relevant sportsbook, and everyone reads from
 * the result.
 *
 * Credits: a request costs (markets returned) x (region units), and every 10
 * named bookmakers count as one region unit. 16 books = 2 units, so one
 * refresh of a game is 8 markets x 2 = 16 credits; a 14-game window refreshed
 * every 90 minutes is ~3.6k credits/day, inside a 100k/month key. The player
 * page can ask for fresher data on the single game it shows.
 */
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

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

// How long cached odds stay fresh for background consumers (home page, cron)
export const ODDS_TTL_MS = 90 * 60 * 1000;
// A player page may refresh the single game it shows if the cache is older than this
export const PLAYER_VIEW_MAX_AGE_MS = 10 * 60 * 1000;
const EVENTS_TTL_MS = 10 * 60 * 1000;
// Events within this window of the first upcoming game are shown (roughly
// tonight's slate plus tomorrow's early games), capped to bound credit use
const SLATE_WINDOW_MS = 36 * 60 * 60 * 1000;
const MAX_EVENTS = 14;
const FETCH_CONCURRENCY = 3;
// After a quota/auth error, stop calling the API for a while and serve stale data
const QUOTA_BACKOFF_MS = 15 * 60 * 1000;

const HEADERS = { 'User-Agent': 'HoopForecast/2.0' };

let eventsCache = { events: [], fetchedAt: 0 };
const oddsCache = new Map();     // eventId -> { event, data, fetchedAt }
const inFlight = new Map();      // eventId -> Promise
let quotaBlockedUntil = 0;
const usage = { remaining: null, used: null, lastCost: null, updatedAt: null, blockedUntil: null };

function recordUsage(headers) {
  if (!headers) return;
  const num = (v) => (v == null ? null : Number(v));
  if (headers['x-requests-remaining'] != null) usage.remaining = num(headers['x-requests-remaining']);
  if (headers['x-requests-used'] != null) usage.used = num(headers['x-requests-used']);
  if (headers['x-requests-last'] != null) usage.lastCost = num(headers['x-requests-last']);
  usage.updatedAt = new Date().toISOString();
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

/** Credit usage as reported by the API's response headers (for /api/health). */
export function getOddsApiUsage() {
  return { ...usage, cachedEvents: oddsCache.size, bookmakers: BOOKMAKERS.length };
}

/**
 * Upcoming events for the current slate: games within 24h of the first
 * upcoming game, capped. The events endpoint costs no credits.
 */
export async function getUpcomingEvents() {
  if (!API_KEY) return [];
  const age = Date.now() - eventsCache.fetchedAt;
  if (eventsCache.events.length && age < EVENTS_TTL_MS) return eventsCache.events;
  if (Date.now() < quotaBlockedUntil) return eventsCache.events;

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
    return events;
  } catch (err) {
    if (isQuotaError(err)) blockForQuota(err);
    else console.error('Odds API events error:', err.message);
    return eventsCache.events;
  }
}

/** Cached odds for one event, or null. Never calls the API. */
export function getCachedEventOdds(eventId) {
  return oddsCache.get(eventId)?.data || null;
}

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
 * Odds for one event (all prop markets, all bookmakers). Served from cache
 * while younger than maxAgeMs; otherwise refetched. Concurrent callers share
 * one request. Returns stale data rather than nothing when the API fails.
 */
export async function getEventOdds(event, { maxAgeMs = ODDS_TTL_MS } = {}) {
  if (!API_KEY || !event?.id) return null;
  const cached = oddsCache.get(event.id);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached.data;
  if (Date.now() < quotaBlockedUntil) return cached?.data || null;
  if (inFlight.has(event.id)) return inFlight.get(event.id);

  const request = fetchEventOdds(event)
    .then(data => {
      oddsCache.set(event.id, { event, data, fetchedAt: Date.now() });
      return data;
    })
    .catch(err => {
      if (isQuotaError(err)) blockForQuota(err);
      else console.error(`Odds API error for ${event.away_team} @ ${event.home_team}:`, err.message);
      return cached?.data || null;
    })
    .finally(() => inFlight.delete(event.id));

  inFlight.set(event.id, request);
  return request;
}

/**
 * Odds for every event in the current slate, as [{ event, data }].
 * Fetches a few events at a time to stay clear of the API's rate limit.
 */
export async function getAllEventOdds({ maxAgeMs = ODDS_TTL_MS } = {}) {
  const events = await getUpcomingEvents();
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
