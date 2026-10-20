#!/usr/bin/env node
/**
 * Backfill The Odds API historical player-prop snapshots for the archived
 * prediction history, so joinHistoricalOdds.mjs can give every old record a
 * pick-time `market` summary and a `closing` snapshot.
 *
 *   node backend/scripts/backfillHistoricalOdds.mjs [--dry-run] [--limit-dates N]
 *        [--max-credits N] [--in FILE] [--out-dir DIR] [--batch-gap-minutes N] [--concurrency N]
 *
 * For each game date in the export (next_game.date, ET calendar day):
 *   1. list that day's events once (historical events endpoint, snapshot at
 *      noon ET; cached as <out-dir>/events_<date>.json)
 *   2. for each event fetch
 *      - a closing snapshot 5 minutes before commence_time
 *      - a pick-time snapshot per "batch" of created_at timestamps on that
 *        date: records are clustered when consecutive created_at values are
 *        within --batch-gap-minutes (default 90, i.e. one morning and one
 *        evening cron run per calendar day); the snapshot timestamp is the
 *        batch's EARLIEST created_at rounded down to 5 minutes, so no record
 *        ever sees a snapshot taken after it was created. A batch that falls
 *        after the closing time shares the closing snapshot (no extra call).
 *      All 8 prop markets and the 16 books go in one call per snapshot.
 *
 * Resume-safe: every raw response is cached under
 * <out-dir>/<eventId>_<timestamp>.json (gitignored) and existing files are
 * skipped. Game dates are the UTC day of tip-off, as the archive stores them. Props are posted monotonically, so when a pick-time snapshot comes
 * back without any prop market, earlier batches for that event are marked
 * empty without a call. Credits are read from the x-requests-last /
 * x-requests-used / x-requests-remaining headers; the run stops before the
 * cumulative spend of this script (the cost recorded in every cached file) would exceed --max-credits (default 400,000).
 *
 * Costs (historical = 10x live): odds snapshot = 8 markets x 2 region units
 * (16 books) x 10 = 160 credits; events listing = 1 credit (two per date).
 *
 * This is a one-off offline script, the one place outside
 * services/oddsEventCache.js that calls the API directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { BOOKMAKERS, PROP_MARKETS } from '../services/oddsEventCache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const API_BASE = 'https://api.the-odds-api.com/v4/historical/sports/basketball_nba';
const DATA_DIR = path.join(__dirname, '../data');
const IN = opt('--in', path.join(DATA_DIR, 'predictions_export_fv.json'));
const OUT_DIR = opt('--out-dir', path.join(DATA_DIR, 'odds_history'));
const DRY_RUN = flag('--dry-run');
const LIMIT_DATES = Number(opt('--limit-dates', 0)) || 0;
const MAX_CREDITS = Number(opt('--max-credits', 400000));
const BATCH_GAP_MS = Number(opt('--batch-gap-minutes', 90)) * 60 * 1000;
const CONCURRENCY = Number(opt('--concurrency', 3));
const CLOSING_LEAD_MS = 5 * 60 * 1000;
const REGION_UNITS = Math.ceil(BOOKMAKERS.length / 10);
export const SNAPSHOT_COST = PROP_MARKETS.length * REGION_UNITS * 10;
const EVENTS_COST = 1; // per listing; two listings per date
const USAGE_FILE = path.join(OUT_DIR, '_usage.json');

// ----------------------------------------------------------------- helpers

/** YYYY-MM-DD from an ISO string or a display date such as "Mar 28, 2026". */
export function isoDate(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const floor5 = (ms) => Math.floor(ms / 300000) * 300000;
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fileStamp = (ms) => stamp(ms).replace(/:/g, '-');
export const snapshotFile = (eventId, ms) => path.join(OUT_DIR, `${eventId}_${fileStamp(ms)}.json`);
export const eventsFile = (date) => path.join(OUT_DIR, `events_${date}.json`);

/**
 * Cluster sorted timestamps: a new batch starts when the gap from the
 * previous timestamp exceeds gapMs. Returns the earliest timestamp of each
 * batch, floored to 5 minutes.
 */
export function batchTimes(sortedMs, gapMs = BATCH_GAP_MS) {
  const out = [];
  let start = null, prev = null;
  for (const t of sortedMs) {
    if (start == null || t - prev > gapMs) { start = t; out.push(floor5(t)); }
    prev = t;
  }
  return out;
}

/** The snapshot time a record created at `createdMs` uses, given its date's batches and the event's closing time. */
export function snapshotTimeFor(createdMs, batches, closingMs) {
  let t = null;
  for (const b of batches) if (b <= createdMs) t = b;
  if (t == null) t = floor5(createdMs);
  return Math.min(t, closingMs);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

const hasProps = (data) => (data?.bookmakers || []).some(b => (b.markets || []).some(m => PROP_MARKETS.includes(m.key)));

// -------------------------------------------------------------- API client

const usage = { used: null, remaining: null, spentThisRun: 0, spentBefore: 0, calls: 0 };

async function apiGet(url, params, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await axios.get(url, { params: { apiKey: API_KEY, ...params }, headers: { 'User-Agent': 'HoopForecast/2.0 backfill' }, timeout: 30000 });
      const h = res.headers;
      const last = Number(h['x-requests-last']);
      if (Number.isFinite(last)) usage.spentThisRun += last;
      if (h['x-requests-used'] != null) usage.used = Number(h['x-requests-used']);
      if (h['x-requests-remaining'] != null) usage.remaining = Number(h['x-requests-remaining']);
      usage.calls++;
      return { data: res.data, cost: Number.isFinite(last) ? last : null };
    } catch (err) {
      const status = err.response?.status;
      const code = err.response?.data?.error_code;
      if (status === 401 || status === 403 || code === 'OUT_OF_USAGE_CREDITS') {
        throw new Error(`Odds API auth/quota error ${status} ${code || ''}: ${JSON.stringify(err.response?.data)}`);
      }
      if (status === 404 || status === 422) return { data: null, cost: 0, error: `${status} ${JSON.stringify(err.response?.data)}` };
      if (attempt >= tries) throw err;
      const wait = status === 429 ? 5000 * attempt : 1500 * attempt;
      console.warn(`  retry ${attempt}/${tries} after ${status || err.code} (${wait} ms)`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

function printUsage(prefix = '') {
  const total = usage.spentBefore + usage.spentThisRun;
  console.log(`${prefix}credits: this run ${usage.spentThisRun.toLocaleString()} (${usage.calls} calls), script total ${total.toLocaleString()} / cap ${MAX_CREDITS.toLocaleString()}; key used ${usage.used?.toLocaleString() ?? '?'}, remaining ${usage.remaining?.toLocaleString() ?? '?'}`);
}

function saveUsage() {
  writeJson(USAGE_FILE, { spent_total: usage.spentBefore + usage.spentThisRun, key_used: usage.used, key_remaining: usage.remaining, updated_at: new Date().toISOString() });
}

/** Stop before a call that would push the script's cumulative spend past the cap. */
function assertBudget(nextCost) {
  if (usage.spentBefore + usage.spentThisRun + nextCost > MAX_CREDITS) {
    throw new Error(`--max-credits ${MAX_CREDITS} would be exceeded by the next ${nextCost}-credit call; stopping (re-run resumes from the cache)`);
  }
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Events for a game date. The archived records' next_game.date is the UTC
 * calendar day of the tip-off (a 7:40pm ET game on the 11th is dated the
 * 12th), so the day's events are those with commence_time on that UTC day.
 * A historical events snapshot only lists games the books have posted and
 * that have not started, so the day is listed twice: its first half (the
 * previous ET evening's games) from a snapshot at 22:00Z the day before,
 * its second half (that ET day's games) from a snapshot at 15:00Z.
 */
async function listEvents(date) {
  const file = eventsFile(date);
  const cached = readJson(file);
  if (cached) return cached.data || [];
  if (DRY_RUN) console.log(`  (dry-run) listing events for ${date} (2 x ${EVENTS_COST} credit, cached afterwards)`);
  const halves = [
    { at: `${addDays(date, -1)}T22:00:00Z`, from: `${date}T00:00:00Z`, to: `${date}T11:59:59Z` },
    { at: `${date}T15:00:00Z`, from: `${date}T12:00:00Z`, to: `${date}T23:59:59Z` }
  ];
  const byId = new Map();
  const snapshots = [];
  for (const h of halves) {
    assertBudget(EVENTS_COST);
    const res = await apiGet(`${API_BASE}/events`, { date: h.at, commenceTimeFrom: h.from, commenceTimeTo: h.to });
    snapshots.push({ ...h, snapshot_timestamp: res.data?.timestamp || null, cost: res.cost });
    for (const e of res.data?.data || []) {
      if ((e.commence_time || '').slice(0, 10) !== date) continue;
      byId.set(e.id, { id: e.id, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team });
    }
  }
  const events = [...byId.values()].sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  if (!events.length) console.log(`  ${date}: no events with a tip-off on that UTC day`);
  writeJson(file, { date, snapshots, cost: snapshots.reduce((s, x) => s + (x.cost || 0), 0), fetched_at: new Date().toISOString(), data: events });
  return events;
}

async function fetchSnapshot(event, ms, kind) {
  const file = snapshotFile(event.id, ms);
  if (fs.existsSync(file)) return readJson(file);
  assertBudget(SNAPSHOT_COST);
  const res = await apiGet(`${API_BASE}/events/${event.id}/odds`, {
    date: stamp(ms), markets: PROP_MARKETS.join(','), bookmakers: BOOKMAKERS.join(','), oddsFormat: 'american'
  });
  const payload = {
    event_id: event.id, kind, requested_at: stamp(ms), commence_time: event.commence_time,
    snapshot_timestamp: res.data?.timestamp || null, cost: res.cost, error: res.error || null,
    fetched_at: new Date().toISOString(), data: res.data?.data || null
  };
  writeJson(file, payload);
  return payload;
}

// ------------------------------------------------------------------- plan

function buildPlan(predictions) {
  const byDate = new Map(); // date -> sorted created_at ms
  for (const p of predictions) {
    const date = isoDate(p.next_game?.date) || isoDate(p.created_at);
    const created = new Date(p.created_at).getTime();
    if (!date || !Number.isFinite(created)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(created);
  }
  const dates = [...byDate.keys()].sort();
  return { dates: LIMIT_DATES ? dates.slice(0, LIMIT_DATES) : dates, allDates: dates.length, byDate };
}

/** The snapshot times an event needs: closing plus every batch strictly before it. */
function eventSnapshots(event, batches) {
  const tip = new Date(event.commence_time).getTime();
  const closingMs = floor5(tip - CLOSING_LEAD_MS);
  const picks = [...new Set(batches.filter(b => b < closingMs))].sort((a, b) => b - a); // latest first
  return { closingMs, picks };
}

async function main() {
  if (!API_KEY && !DRY_RUN) throw new Error('ODDS_API_KEY is not set (backend/.env)');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  usage.spentBefore = cachedSpend();

  const predictions = (readJson(IN) || {}).predictions || [];
  if (!predictions.length) throw new Error(`no predictions in ${IN}`);
  const plan = buildPlan(predictions);
  console.log(`${predictions.length} records over ${plan.allDates} game dates; processing ${plan.dates.length}${DRY_RUN ? ' (dry-run)' : ''}`);
  console.log(`snapshot cost ${SNAPSHOT_COST} credits (${PROP_MARKETS.length} markets x ${REGION_UNITS} region units x 10); cap ${MAX_CREDITS.toLocaleString()}, already spent by this script ${usage.spentBefore.toLocaleString()}`);

  const totals = { events: 0, snapshotsPlanned: 0, snapshotsCached: 0, snapshotsFetched: 0, snapshotsInherited: 0, eventsListed: 0, batchHist: {} };
  let stopped = false;

  for (const date of plan.dates) {
    const created = byDateSorted(plan.byDate.get(date));
    const batches = batchTimes(created);
    totals.batchHist[batches.length] = (totals.batchHist[batches.length] || 0) + 1;
    let events;
    try {
      if (!fs.existsSync(eventsFile(date))) totals.eventsListed++;
      events = await listEvents(date);
    } catch (err) { console.error(`${date}: ${err.message}`); stopped = true; break; }
    totals.events += events.length;

    // Work per event: closing first, then pick batches latest-first
    const todo = [];
    for (const event of events) {
      const { closingMs, picks } = eventSnapshots(event, batches);
      todo.push({ event, closingMs, picks });
      totals.snapshotsPlanned += 1 + picks.length;
      for (const ms of [closingMs, ...picks]) if (fs.existsSync(snapshotFile(event.id, ms))) totals.snapshotsCached++;
    }
    const need = todo.reduce((s, t) => s + [t.closingMs, ...t.picks].filter(ms => !fs.existsSync(snapshotFile(t.event.id, ms))).length, 0);
    console.log(`${date}: ${events.length} events, ${batches.length} pick batches (${batches.map(b => stamp(b).slice(5, 16)).join(', ')}), ${need} snapshots to fetch (<= ${(need * SNAPSHOT_COST).toLocaleString()} credits)`);
    if (DRY_RUN) continue;

    try {
      await runPool(todo, CONCURRENCY, async ({ event, closingMs, picks }) => {
        const closing = await fetchSnapshot(event, closingMs, 'closing');
        if (closing.cost) totals.snapshotsFetched++;
        let inheritEmpty = false;
        for (const ms of picks) {
          const file = snapshotFile(event.id, ms);
          if (inheritEmpty) {
            if (!fs.existsSync(file)) {
              writeJson(file, { event_id: event.id, kind: 'pick', requested_at: stamp(ms), commence_time: event.commence_time, snapshot_timestamp: null, cost: 0, empty_inherited: true, fetched_at: new Date().toISOString(), data: null });
              totals.snapshotsInherited++;
            }
            continue;
          }
          const snap = await fetchSnapshot(event, ms, 'pick');
          if (snap.cost) totals.snapshotsFetched++;
          if (!snap.empty_inherited && !hasProps(snap.data)) inheritEmpty = true; // nothing posted yet: earlier batches are empty too
        }
      });
    } catch (err) {
      console.error(`${date}: ${err.message}`);
      stopped = true;
    }
    saveUsage();
    printUsage(`  `);
    if (stopped) break;
  }

  console.log('\nSummary');
  console.log(`  dates ${plan.dates.length}/${plan.allDates}, events ${totals.events}, pick batches per date: ${JSON.stringify(totals.batchHist)}`);
  console.log(`  snapshots planned ${totals.snapshotsPlanned}, already cached ${totals.snapshotsCached}, fetched now ${totals.snapshotsFetched}, marked empty without a call ${totals.snapshotsInherited}`);
  if (DRY_RUN) {
    const toFetch = totals.snapshotsPlanned - totals.snapshotsCached;
    const est = toFetch * SNAPSHOT_COST + totals.eventsListed * 2 * EVENTS_COST;
    console.log(`  estimated cost of a full run from here: ${toFetch} snapshots x ${SNAPSHOT_COST} = ${est.toLocaleString()} credits (upper bound; batches before props were posted are skipped for free)`);
    console.log(`  ${est > MAX_CREDITS ? 'EXCEEDS' : 'within'} --max-credits ${MAX_CREDITS.toLocaleString()}`);
  }
  printUsage('  ');
  if (stopped) process.exit(2);
}

/** Credits this script has spent so far: the cost recorded in every cached response (survives a killed run). */
function cachedSpend() {
  let total = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const cost = readJson(path.join(OUT_DIR, f))?.cost;
    if (Number.isFinite(cost)) total += cost;
  }
  return total;
}

function byDateSorted(list) { return [...list].sort((a, b) => a - b); }

async function runPool(items, n, fn) {
  let i = 0, failed = null;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !failed) {
      const item = items[i++];
      try { await fn(item); } catch (err) { failed = err; }
    }
  });
  await Promise.all(workers);
  if (failed) throw failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
