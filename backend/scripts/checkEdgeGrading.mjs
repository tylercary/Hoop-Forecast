#!/usr/bin/env node
/**
 * Checks that the edge model's grading is right.
 *
 *   node backend/scripts/checkEdgeGrading.mjs                 # unit checks only (no network)
 *   node backend/scripts/checkEdgeGrading.mjs --in FILE       # + verify an export against ESPN box scores
 *       [--date YYYY-MM-DD]   only games on this UTC date (repeatable); default: every graded game
 *       [--base URL]          API to compare the recount with (default: production)
 *       [--sample N]          box-score verification stops after N records per prop per game (default: all)
 *
 * Unit checks run the real evaluation service against a scratch store with a
 * fake ESPN game log: game matching for ISO, legacy and late-tip dates, every
 * prop type including the combos, DNP vs a 0-stat miss, duplicate records,
 * pushes, pending gating by tip-off time, and the grading summary's recount.
 *
 * The export check (after a night of games) recomputes every graded record's
 * actual_value from the ESPN box score, checks that DNPs really did not play,
 * that hit/miss/push follows from actual vs line, and that
 * GET /api/performance/edge agrees exactly with a recount from the export.
 *
 * Exits non-zero on any failure.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const opts = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

let failures = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const eq = (a, b, msg) => (JSON.stringify(a) === JSON.stringify(b) ? ok(msg) : fail(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

// Scratch store for the unit checks: the tracking service reads DATA_DIR at import
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-grading-check-'));
process.env.DATA_DIR = scratch;
const tracking = await import('../services/predictionTrackingService.js');
const evaluation = await import('../services/predictionEvaluationService.js');
const grading = await import('../services/edgeGradingService.js');

// ---------------------------------------------------------------------------
// Unit checks
// ---------------------------------------------------------------------------
console.log('Unit checks');

const PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra'];
const NOW = Date.parse('2026-10-21T14:00:00Z'); // the morning after opening night, US time

// ESPN-style game-log entries (UTC calendar date of tip-off)
const game = (date, opponent, pts, reb, ast, tpm) => ({
  date, opponent, pts, reb, ast, tpm, stl: 1, blk: 0, minutes: '34',
  points: pts, rebounds: reb, assists: ast, threes: tpm
});
const logs = {
  'early tipper': { games: [game('2026-10-20', 'DET', 25, 10, 5, 3), game('2026-05-01', 'MIA', 20, 4, 4, 2)] },
  'late tipper': { games: [game('2026-10-21', 'SAS', 31, 7, 9, 4)] },          // 9:30pm ET on Oct 20
  'scratched': { games: [game('2026-10-15', 'LAL', 12, 3, 2, 1)] },            // no game on Oct 20
  'pusher': { games: [game('2026-10-20', 'NYK', 20, 10, 5, 2)] },
  'legacy date': { games: [game('2026-10-20', 'PHI', 18, 6, 7, 1)] },
  'local date': { games: [game('2026-10-21', 'OKC', 14, 11, 2, 0)] },         // stored with the US date
  'not yet final': { games: [] },
};
const fetchStats = async (name) => logs[name.toLowerCase()] || { games: [] };

const base = (over) => ({
  predicted_value: over, confidence: 'Medium', error_margin: 3, model_variant: 'edge', method: 'xgboost_model', stats: {}
});
const store = (player, prop, line, rec, prob, nextGame, extra = {}) =>
  tracking.storePrediction(player, { ...base(line + (rec === 'UNDER' ? -2 : 2)), betting_line: line, recommendation: rec, over_probability: prob, ...extra }, [], nextGame, prop);

// One record per prop for the early tipper: expected actuals from the game log
const expectedEarly = { points: 25, rebounds: 10, assists: 5, threes: 3, pra: 40, pr: 35, pa: 30, ra: 15 };
const earlyGame = { date: '2026-10-20', opponent: 'DET', team: 'BOS', commence_time: '2026-10-20T23:00:00Z' };
const earlyIds = {};
for (const prop of PROPS) earlyIds[prop] = store('Early Tipper', prop, expectedEarly[prop] - 0.5, 'OVER', 60, earlyGame);

const lateGame = { date: '2026-10-21', opponent: 'SAS', team: 'OKC', commence_time: '2026-10-21T01:30:00Z' };
const lateId = store('Late Tipper', 'pra', 45.5, 'OVER', 58, lateGame);          // actual 47 -> hit
const scratchedId = store('Scratched', 'points', 15.5, 'UNDER', 40, { date: '2026-10-20', opponent: 'DET', team: 'BOS', commence_time: '2026-10-20T23:00:00Z' });
const pushId = store('Pusher', 'rebounds', 10, 'OVER', 57, { date: '2026-10-20', opponent: 'NYK', team: 'PHI', commence_time: '2026-10-20T23:00:00Z' });
const legacyId = store('Legacy Date', 'assists', 6.5, 'OVER', 59, { date: 'Oct 20, 2026', opponent: 'PHI', team: 'NYK', commence_time: '2026-10-20T23:00:00Z' });
const localId = store('Local Date', 'rebounds', 9.5, 'OVER', 61, { date: '2026-10-20', opponent: 'OKC', team: 'SAS', commence_time: '2026-10-21T01:30:00Z' });
const notFinalId = store('Not Yet Final', 'points', 20.5, 'OVER', 58, { date: '2026-10-21', opponent: 'MIL', team: 'WAS', commence_time: '2026-10-21T23:00:00Z' });

// A legacy-dated duplicate of an existing record, as the live store held before dates were normalised
{
  const data = JSON.parse(JSON.stringify({ predictions: tracking.getAllPredictions() }));
  const twin = JSON.parse(JSON.stringify(tracking.getAllPredictions().find(p => p.id === earlyIds.points)));
  twin.id = 'pred_legacy_twin';
  twin.next_game.date = 'Oct 20, 2026';
  twin.created_at = '2026-10-19T20:00:00Z'; // older than the ISO record
  tracking.getAllPredictions().push(twin);
  void data;
}

// Pending gating: before 4h after tip nothing is pending, afterwards the finished games are
{
  const beforeTip = tracking.getPendingEvaluations({ now: Date.parse('2026-10-20T22:00:00Z') });
  eq(beforeTip.length, 0, 'nothing pending before any game has tipped');
  const duringLate = tracking.getPendingEvaluations({ now: Date.parse('2026-10-21T03:30:00Z') }).map(p => p.id);
  check(duringLate.includes(earlyIds.points) && !duringLate.includes(lateId), 'a 7pm ET game is pending 4h after tip, the 9:30pm ET game is not yet');
  const morning = tracking.getPendingEvaluations({ now: NOW }).map(p => p.id);
  check(morning.includes(lateId) && !morning.includes(notFinalId), 'the morning after, the late game is pending and tonight\'s game is not');
}

// Evaluate the morning after opening night
const first = await evaluation.evaluatePendingPredictions({ fetchStats, now: () => NOW, delays: false });
const byId = (id) => tracking.getAllPredictions().find(p => p.id === id);
for (const prop of PROPS) eq(byId(earlyIds[prop]).actual_value, expectedEarly[prop], `${prop} actual from the box score`);
eq(byId(lateId).actual_value, 47, '10pm ET game stored as the next UTC day matches the ESPN game-log date');
eq(byId(legacyId).actual_value, 7, 'legacy "Oct 20, 2026" record matches the ISO game-log date');
eq(byId(localId).actual_value, 11, 'record dated with the US calendar day still finds the game via tip-off time + opponent');
eq(byId(pushId).actual_value, 10, 'push record graded with the actual stat');
eq([byId(scratchedId).evaluated, byId(scratchedId).dnp], [false, undefined], 'no game within 3 days: skipped, not graded as 0');
eq(byId(notFinalId).evaluated, false, 'game that has not finished is untouched');
eq(byId('pred_legacy_twin').actual_value, 25, 'legacy twin graded too (grading dedupes it below)');

// Three days later the scratched player is DNP, never a 0-stat miss
await evaluation.evaluatePendingPredictions({ fetchStats, now: () => NOW + 3 * 86400000, delays: false });
eq([byId(scratchedId).evaluated, byId(scratchedId).dnp, byId(scratchedId).actual_value], [true, true, null], 'player who did not play is DNP with no actual value');
check(first.results.every(r => r.status !== 'failed'), 'no evaluation failures');

// Grading summary recount
const summary = grading.gradeEdgePredictions(tracking.getAllPredictions());
const rows = grading.eligibleRows(tracking.getAllPredictions());
eq(rows.filter(r => r.player === 'Early Tipper' && r.prop === 'points').length, 1, 'duplicate record counted once in grading');
check(!rows.some(r => r.player === 'Scratched'), 'DNP excluded from grading');
const expectRecs = { n: 10, hits: 10, pushes: 1 }; // 8 early (all OVER hits) + late hit + legacy hit + local hit = 11 picks minus... see below
// Picks: 8 early OVER hits, late OVER hit (47 > 45.5), legacy OVER hit (7 > 6.5), local OVER hit (11 > 9.5), push (10 = 10)
expectRecs.n = 11; expectRecs.hits = 11;
eq([summary.overall.recommendations.n, summary.overall.recommendations.hits, summary.overall.recommendations.pushes],
  [expectRecs.n, expectRecs.hits, expectRecs.pushes], 'recommendations n/hits/pushes: push is neither hit nor miss');
eq(summary.overall.pushes, 1, 'overall push count');
eq(summary.overall.recommendations.bets, 12, 'push still counted as a bet (stake returned)');
eq(summary.by_prop.rebounds.recommendations, { ...summary.by_prop.rebounds.recommendations, n: 2, hits: 2, pushes: 1 }, 'rebounds slice: 2 decided hits + 1 push');
const recentPush = summary.recent.find(r => r.id === pushId);
eq(recentPush && recentPush.result, 'push', 'recent list marks the push');
eq(recentPush && recentPush.units, 0, 'push returns the stake');

// Store-level dedupe pass (what the server runs at startup)
const dd = tracking.dedupeGamePredictions();
eq(dd.removed.map(r => r.id), ['pred_legacy_twin'], 'dedupe pass removes the older legacy twin');
check(tracking.getAllPredictions().every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.next_game.date)), 'all game dates ISO after the pass');
eq(tracking.dedupeGamePredictions(), { normalized: 0, removed: [] }, 'dedupe pass is idempotent');

// Pure helpers
eq(evaluation.actualForProp({ pts: 3, reb: 4, ast: 5, tpm: 1 }, 'pra'), 12, 'actualForProp pra');
eq(evaluation.actualForProp({ points: 3, rebounds: 4, assists: 5, threes: 1 }, 'ra'), 9, 'actualForProp ra from legacy keys');
eq(evaluation.findGameForPrediction([game('2026-10-21', 'SAS', 1, 1, 1, 1)], { next_game: { date: '2026-10-20', opponent: 'DET', commence_time: '2026-10-21T01:30:00Z' } }), null,
  'tip-off fallback refuses a game against a different opponent');

tracking.flushPredictionsSync();
fs.rmSync(scratch, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Export verification against ESPN box scores
// ---------------------------------------------------------------------------
const inFile = opt('--in', null);
if (inFile) {
  console.log(`\nExport check: ${inFile}`);
  const exported = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const predictions = exported.predictions || exported;
  const dates = new Set(opts('--date'));
  const sampleN = Number(opt('--sample', 0)) || 0;
  const isoDate = (v) => tracking.normalizeGameDate(v);

  const graded = predictions.filter(p => p.evaluated && (p.model_variant || 'legacy') === 'edge' && (!dates.size || dates.has(isoDate(p.next_game?.date))));
  const counts = { evaluated: 0, pending: 0, dnp: 0, expired: 0, non_iso_date: 0 };
  const perProp = {};
  for (const p of predictions) {
    if (dates.size && !dates.has(isoDate(p.next_game?.date))) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.next_game?.date || '')) counts.non_iso_date++;
    const slot = p.expired ? 'expired' : p.dnp ? 'dnp' : p.evaluated ? 'evaluated' : 'pending';
    counts[slot]++;
    (perProp[p.prop_type] ||= { evaluated: 0, pending: 0, dnp: 0, expired: 0 })[slot]++;
  }
  console.log('  counts', JSON.stringify(counts));
  for (const [prop, c] of Object.entries(perProp)) console.log(`  ${prop.padEnd(9)} ${JSON.stringify(c)}`);

  // Duplicate keys in the export
  const keys = new Map();
  for (const p of predictions) {
    const k = `${(p.player_name || '').toLowerCase()}|${p.prop_type}|${isoDate(p.next_game?.date)}`;
    keys.set(k, (keys.get(k) || 0) + 1);
  }
  const dups = [...keys].filter(([, n]) => n > 1);
  check(dups.length === 0, `no duplicate player/prop/game keys in the export${dups.length ? `: ${dups.slice(0, 5).map(([k]) => k).join(', ')}` : ''}`);

  // Box scores per game, keyed by the two team abbreviations and the UTC date
  const ESPN_ABBR = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
  const nba = (a) => ESPN_ABBR[(a || '').toUpperCase()] || (a || '').toUpperCase();
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
  const fetchJson = async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return res.json();
  };
  const gameKey = (teamA, teamB, date) => `${[nba(teamA), nba(teamB)].sort().join('-')}|${date}`;
  const neededGames = new Map();
  for (const p of graded) {
    if (p.expired) continue;
    const date = isoDate(p.next_game?.date);
    const key = gameKey(p.next_game?.team, p.next_game?.opponent, date);
    if (!neededGames.has(key)) neededGames.set(key, { date, teams: [nba(p.next_game?.team), nba(p.next_game?.opponent)], records: [] });
    neededGames.get(key).records.push(p);
  }
  const normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

  const boxScores = new Map(); // gameKey -> Map(normName -> { played, pts, reb, ast, tpm })
  const scoreboards = new Map();
  for (const [key, g] of neededGames) {
    // ESPN's scoreboard is keyed by the US date; the stored date is the UTC date, so try it and the day before
    const candidates = [g.date, new Date(Date.parse(`${g.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)];
    let event = null;
    for (const d of candidates) {
      const ymd = d.replace(/-/g, '');
      if (!scoreboards.has(ymd)) scoreboards.set(ymd, (await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`)).events || []);
      event = scoreboards.get(ymd).find(e => {
        const abbrs = (e.competitions?.[0]?.competitors || []).map(c => nba(c.team?.abbreviation));
        return g.teams.every(t => abbrs.includes(t)) && (e.date || '').slice(0, 10) === g.date;
      });
      if (event) break;
    }
    if (!event) { fail(`no ESPN event found for ${key}`); continue; }
    if (event.status?.type?.name !== 'STATUS_FINAL') fail(`${key} is not final on ESPN (${event.status?.type?.name})`);
    const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`);
    const players = new Map();
    for (const team of summary.boxscore?.players || []) {
      const stat = team.statistics?.[0];
      const labels = stat?.labels || [];
      const idx = (label) => labels.indexOf(label);
      for (const a of stat?.athletes || []) {
        const s = a.stats || [];
        const made = (v) => Number(String(v || '0').split('-')[0]) || 0;
        const minutes = Number(s[idx('MIN')]) || 0;
        players.set(normName(a.athlete?.displayName), {
          played: !a.didNotPlay && minutes > 0,
          reason: a.reason || null,
          pts: Number(s[idx('PTS')]) || 0, reb: Number(s[idx('REB')]) || 0, ast: Number(s[idx('AST')]) || 0, tpm: made(s[idx('3PT')])
        });
      }
    }
    boxScores.set(key, players);
    ok(`box score ${key}: ESPN event ${event.id}, ${players.size} players`);
  }

  // Every graded record against the box score
  let compared = 0, agreed = 0;
  const perPropSeen = new Map();
  const wrong = [];
  for (const [key, g] of neededGames) {
    const box = boxScores.get(key);
    if (!box) continue;
    for (const p of g.records) {
      const slot = `${key}|${p.prop_type}`;
      perPropSeen.set(slot, (perPropSeen.get(slot) || 0) + 1);
      if (sampleN && perPropSeen.get(slot) > sampleN) continue;
      const line = box.get(normName(p.player_name));
      compared++;
      if (!line) { wrong.push({ id: p.id, player: p.player_name, prop: p.prop_type, issue: 'player not in box score', stored: p.dnp ? 'DNP' : p.actual_value }); continue; }
      if (p.dnp) {
        if (line.played) wrong.push({ id: p.id, player: p.player_name, prop: p.prop_type, issue: 'marked DNP but played', correct: evaluation.actualForProp(line, p.prop_type) });
        else agreed++;
        continue;
      }
      if (!line.played) { wrong.push({ id: p.id, player: p.player_name, prop: p.prop_type, issue: `graded ${p.actual_value} but did not play (${line.reason || 'DNP'})`, correct: 'DNP' }); continue; }
      const expect = evaluation.actualForProp(line, p.prop_type);
      if (expect !== p.actual_value) { wrong.push({ id: p.id, player: p.player_name, prop: p.prop_type, issue: 'actual_value differs', stored: p.actual_value, correct: expect }); continue; }
      agreed++;
    }
  }
  check(compared > 0, `compared ${compared} graded records against ESPN box scores`);
  check(wrong.length === 0, `${agreed}/${compared} agree with the box score`);
  for (const w of wrong) console.log('    ', JSON.stringify(w));

  // hit/miss/push follows from actual vs line and the recommendation
  const recount = grading.gradeEdgePredictions(predictions);
  const rows = grading.eligibleRows(predictions);
  let resultBad = 0;
  for (const r of rows) {
    const over = r.actual > r.line ? 1 : r.actual < r.line ? 0 : null;
    if (over !== r.over) resultBad++;
  }
  check(resultBad === 0, 'over/under/push of every graded row follows from actual vs line');
  const recs = rows.filter(r => r.rec && r.over != null);
  const hits = recs.filter(r => (r.rec === 'OVER') === (r.over === 1)).length;
  const pushes = rows.filter(r => r.rec && r.over == null).length;
  eq([recount.overall.recommendations.n, recount.overall.recommendations.hits, recount.overall.recommendations.pushes], [recs.length, hits, pushes],
    `recount: ${hits}-${recs.length - hits}-${pushes} picks`);

  // API agreement
  const baseUrl = opt('--base', 'https://zealous-kindness-production-3ecb.up.railway.app/api').replace(/\/$/, '');
  try {
    const api = await fetchJson(`${baseUrl}/performance/edge?variant=edge`);
    const strip = (block) => block && { n: block.n, hits: block.hits, pushes: block.pushes, over: block.over, under: block.under };
    eq(strip(api.overall.recommendations), strip(recount.overall.recommendations), 'API overall.recommendations equals the export recount');
    eq(api.overall.n, recount.overall.n, 'API overall.n equals the export recount');
    eq(Object.fromEntries(Object.entries(api.by_prop).map(([k, v]) => [k, strip(v.recommendations)])),
      Object.fromEntries(Object.entries(recount.by_prop).map(([k, v]) => [k, strip(v.recommendations)])), 'API by_prop recommendations equal the export recount');
    if (api.cached_at) console.log(`  (API summary cached at ${api.cached_at}; the export must postdate it for an exact match)`);
  } catch (err) {
    fail(`could not compare with ${baseUrl}: ${err.message}`);
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
