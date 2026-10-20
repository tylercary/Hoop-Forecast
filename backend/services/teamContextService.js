/**
 * Team context: per-team, per-game box score rows (what each team scored and
 * what it allowed) fetched from ESPN, and the opponent-allowance numbers the
 * edge model reads from them as of a date.
 *
 * The rows live in <DATA_DIR>/team_game_stats.json (seeded from backend/ml/team_game_stats.seed.json), keyed by season. The
 * file is committed as a baseline and refreshed in place (new final games
 * only) by refreshTeamGameStats(), which the prediction cron and
 * backend/scripts/refreshTeamGameStats.mjs call.
 *
 * opponentContext() is mirrored line for line in backend/ml/edge_features.py
 * (opponent_context) so training rows and served rows get identical numbers.
 * Keep the two in lockstep; backend/ml/test_edge_lockstep.mjs checks them.
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { getEspnTeamId, mapEspnToNbaAbbrev } from './nbaApiService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Live copy lives with the other runtime data (on Railway that is the mounted
// volume, which hides the image's backend/data); a seed ships in backend/ml so
// a fresh volume still knows last season.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const TEAM_GAME_STATS_FILE = path.join(DATA_DIR, 'team_game_stats.json');
export const TEAM_GAME_STATS_SEED = path.join(__dirname, '..', 'ml', 'team_game_stats.seed.json');

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', Accept: 'application/json' };
const TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM',
  'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'];

// Shrink a team's current-season numbers toward its previous season until it
// has played this many games (same constant in edge_features.py)
export const SHRINK_GAMES = 20;
// Below this many league-wide rows the league baseline comes from last season
export const LEAGUE_MIN_ROWS = 100;

let _data = null;
let _loadedAt = 0;

/** "2026-03-07" -> "2025-26" */
export function seasonForDate(dateStr) {
  const [year, month] = String(dateStr).slice(0, 10).split('-').map(Number);
  const start = month >= 10 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function previousSeason(season) {
  const start = parseInt(season.split('-')[0], 10) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** ESPN names a season by its end year: "2025-26" -> 2026 */
function espnSeasonYear(season) {
  return parseInt(season.split('-')[0], 10) + 1;
}

function readStats(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.seasons && Object.keys(parsed.seasons).length ? parsed : null;
  } catch {
    return null;
  }
}

export function loadTeamGameStats({ force = false } = {}) {
  if (_data && !force) return _data;
  // Seed first, then the live copy on top season by season: a live file that
  // only knows the current (empty) season must not hide last season's games.
  const seed = readStats(TEAM_GAME_STATS_SEED);
  const live = readStats(TEAM_GAME_STATS_FILE);
  const seasons = { ...(seed?.seasons || {}) };
  for (const [season, bucket] of Object.entries(live?.seasons || {})) {
    if ((bucket.games || []).length || !seasons[season]) seasons[season] = bucket;
  }
  const source = live && seed ? 'seed+data' : live ? 'data' : seed ? 'seed' : 'none';
  _data = { updated_at: live?.updated_at || seed?.updated_at || null, seasons };
  _loadedAt = Date.now();
  const summary = Object.entries(_data.seasons).map(([k, v]) => `${k}: ${(v.games || []).length / 2} games`).join(', ');
  console.log(`[TeamContext] team game stats from ${source}${summary ? ` (${summary})` : ' (empty)'}`);
  return _data;
}

/** For /api/health: where the opponent context comes from and how much it knows. */
export function teamGameStatsSummary() {
  const data = loadTeamGameStats();
  const seasons = {};
  for (const [k, v] of Object.entries(data.seasons || {})) seasons[k] = (v.games || []).length / 2;
  return { updated_at: data.updated_at, seasons };
}

function saveTeamGameStats(data) {
  fs.mkdirSync(path.dirname(TEAM_GAME_STATS_FILE), { recursive: true });
  fs.writeFileSync(TEAM_GAME_STATS_FILE, JSON.stringify(data));
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function parseMadeAttempted(v) {
  const [made, att] = String(v || '0-0').split('-').map(Number);
  return { made: made || 0, att: att || 0 };
}

/** Both teams' rows for one final game, from ESPN's summary endpoint. */
async function fetchGameRows(eventId) {
  const { data } = await axios.get(`${ESPN_SITE}/summary`, { params: { event: eventId }, headers: ESPN_HEADERS, timeout: 15000 });
  const teams = data?.boxscore?.teams || [];
  if (teams.length !== 2) return null;
  const date = (data?.header?.competitions?.[0]?.date || '').slice(0, 10);
  const parsed = teams.map(t => {
    const s = {};
    for (const st of t.statistics || []) s[st.name] = st.displayValue;
    const fg = parseMadeAttempted(s['fieldGoalsMade-fieldGoalsAttempted']);
    const fg3 = parseMadeAttempted(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
    const ft = parseMadeAttempted(s['freeThrowsMade-freeThrowsAttempted']);
    const pts = 2 * (fg.made - fg3.made) + 3 * fg3.made + ft.made;
    return {
      t: mapEspnToNbaAbbrev(t.team?.abbreviation), h: t.homeAway === 'home',
      pts, reb: num(s.totalRebounds), ast: num(s.assists), fg3m: fg3.made,
      fga: fg.att, fta: ft.att, oreb: num(s.offensiveRebounds), tov: num(s.totalTurnovers ?? s.turnovers)
    };
  });
  // Possessions: the usual box-score estimate, averaged over both teams
  const poss = parsed.reduce((sum, p) => sum + (p.fga - p.oreb + p.tov + 0.44 * p.fta), 0) / 2;
  return parsed.map((p, i) => {
    const o = parsed[1 - i];
    return {
      e: String(eventId), d: date, t: p.t, o: o.t, h: p.h ? 1 : 0,
      pts: p.pts, reb: p.reb, ast: p.ast, fg3m: p.fg3m, poss: Math.round(poss * 10) / 10,
      opp_pts: o.pts, opp_reb: o.reb, opp_ast: o.ast, opp_fg3m: o.fg3m
    };
  });
}

/** Final event ids (regular season + playoffs) for one team and season. */
async function fetchFinalEventIds(teamAbbrev, season) {
  const ids = [];
  const year = espnSeasonYear(season);
  for (const seasontype of [2, 3]) {
    try {
      const { data } = await axios.get(`${ESPN_SITE}/teams/${getEspnTeamId(teamAbbrev)}/schedule`,
        { params: { season: year, seasontype }, headers: ESPN_HEADERS, timeout: 15000 });
      for (const ev of data?.events || []) {
        if (ev.competitions?.[0]?.status?.type?.name === 'STATUS_FINAL') ids.push(String(ev.id));
      }
    } catch (err) {
      console.warn(`[TeamContext] schedule ${teamAbbrev} ${season} type ${seasontype}: ${err.message}`);
    }
  }
  return ids;
}

/**
 * Fetch any final games not yet in the file for the given seasons and save.
 * @param {string[]} seasons   e.g. ['2025-26']; default: the season of today
 * @param {object} opts        { concurrency, log }
 * @returns {Promise<number>}  games added
 */
export async function refreshTeamGameStats(seasons = [seasonForDate(new Date().toISOString())], { concurrency = 4, log = false } = {}) {
  const data = loadTeamGameStats({ force: true });
  let added = 0;
  for (const season of seasons) {
    const bucket = data.seasons[season] || (data.seasons[season] = { games: [] });
    const have = new Set(bucket.games.map(g => g.e));
    const wanted = new Set();
    for (const team of TEAMS) {
      for (const id of await fetchFinalEventIds(team, season)) if (!have.has(id)) wanted.add(id);
    }
    const queue = [...wanted];
    if (log) console.log(`[TeamContext] ${season}: ${bucket.games.length / 2} games on file, ${queue.length} to fetch`);
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const rows = await fetchGameRows(id);
          if (rows && rows.every(r => r.t && r.o && r.d)) {
            bucket.games.push(...rows);
            added++;
          }
        } catch (err) {
          console.warn(`[TeamContext] summary ${id}: ${err.message}`);
        }
        if (log && added % 50 === 0 && added > 0) process.stdout.write(`\r[TeamContext] ${season}: ${added} fetched`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    bucket.games.sort((a, b) => a.d.localeCompare(b.d) || a.e.localeCompare(b.e));
    if (log) console.log(`\n[TeamContext] ${season}: ${bucket.games.length / 2} games on file`);
  }
  data.updated_at = new Date().toISOString();
  saveTeamGameStats(data);
  _data = data;
  _loadedAt = Date.now();
  return added;
}

const REFRESH_TTL_MS = 12 * 60 * 60 * 1000;
let _refreshing = null;
/** Refresh the current season at most every 12 hours; never throws. */
export async function ensureTeamGameStatsFresh() {
  loadTeamGameStats();
  const stale = !_data.updated_at || Date.now() - new Date(_data.updated_at).getTime() > REFRESH_TTL_MS;
  if (!stale || _refreshing) return _refreshing || Promise.resolve(0);
  _refreshing = refreshTeamGameStats().catch(err => {
    console.warn('[TeamContext] refresh failed:', err.message);
    return 0;
  }).finally(() => { _refreshing = null; });
  return _refreshing;
}

// --------------------------------------------------------------------------
// Opponent allowances as of a date. Mirrored in edge_features.py.
// --------------------------------------------------------------------------

const STAT_KEYS = ['opp_pts', 'opp_reb', 'opp_ast', 'opp_fg3m'];

function meansOf(rows) {
  if (!rows.length) return null;
  const out = { n: rows.length };
  for (const k of STAT_KEYS) out[k] = rows.reduce((s, r) => s + r[k], 0) / rows.length;
  out.pace = rows.reduce((s, r) => s + r.poss, 0) / rows.length;
  const poss = rows.reduce((s, r) => s + r.poss, 0);
  out.def_rating = poss > 0 ? 100 * rows.reduce((s, r) => s + r.opp_pts, 0) / poss : null;
  return out;
}

function blend(cur, prev, n, k) {
  if (cur && prev) {
    const w = Math.min(1, n / k);
    const out = { n };
    for (const key of [...STAT_KEYS, 'pace', 'def_rating']) {
      out[key] = cur[key] == null || prev[key] == null ? (cur[key] ?? prev[key]) : w * cur[key] + (1 - w) * prev[key];
    }
    return out;
  }
  return cur || prev || null;
}

/**
 * What `opponentAbbrev` has allowed per game this season before `asOfDate`,
 * relative to the league, shrunk toward last season early in the year.
 * Every value is null when nothing is known (the model treats null as missing).
 *
 * @param {string} opponentAbbrev
 * @param {string} asOfDate   the game date, YYYY-MM-DD; only earlier games count
 * @param {object} [data]     team game stats (default: the loaded file)
 */
export function opponentContext(opponentAbbrev, asOfDate, data = loadTeamGameStats()) {
  const empty = {
    opp_pts_allowed_rel: null, opp_reb_allowed_rel: null, opp_ast_allowed_rel: null, opp_fg3m_allowed_rel: null,
    opp_pace_rel: null, opp_def_rating_rel: null, opp_games_n: null
  };
  const opp = (opponentAbbrev || '').toUpperCase();
  const date = String(asOfDate || '').slice(0, 10);
  if (!opp || !date || !data?.seasons) return empty;
  const season = seasonForDate(date);
  const curRows = (data.seasons[season]?.games || []).filter(g => g.d < date);
  const prevRows = data.seasons[previousSeason(season)]?.games || [];

  const teamCur = meansOf(curRows.filter(g => g.t === opp));
  const teamPrev = meansOf(prevRows.filter(g => g.t === opp));
  const team = blend(teamCur, teamPrev, teamCur ? teamCur.n : 0, SHRINK_GAMES);
  const leagueCur = curRows.length >= LEAGUE_MIN_ROWS ? meansOf(curRows) : null;
  const league = leagueCur || meansOf(prevRows);
  if (!team || !league) return empty;
  const rel = (k) => (team[k] == null || league[k] == null ? null : Math.round((team[k] - league[k]) * 1000) / 1000);
  return {
    opp_pts_allowed_rel: rel('opp_pts'),
    opp_reb_allowed_rel: rel('opp_reb'),
    opp_ast_allowed_rel: rel('opp_ast'),
    opp_fg3m_allowed_rel: rel('opp_fg3m'),
    opp_pace_rel: rel('pace'),
    opp_def_rating_rel: rel('def_rating'),
    opp_games_n: teamCur ? teamCur.n : 0
  };
}

export const OPPONENT_CONTEXT_KEYS = Object.keys(opponentContext('', ''));
