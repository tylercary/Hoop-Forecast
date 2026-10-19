#!/usr/bin/env node
/**
 * Lockstep check for the edge model's feature construction.
 *
 *   node backend/ml/test_edge_lockstep.mjs
 *
 * Builds an edge row in JavaScript from a fixture (game log, market summary,
 * opponent box scores, injuries), has edge_features.py rebuild the context
 * features from the same fixture and compare them, and finally scores the row
 * with predict_xgboost.py, asserting the saved edge model raises no
 * missing-feature error. Exits non-zero on any difference.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildMLFeatures, buildEdgeRow } from './mlPredictionService.js';
import { opponentContext } from '../services/teamContextService.js';
import { summarizeMarket } from '../services/marketFeatureService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// ---- fixture ---------------------------------------------------------------
const gameDate = '2026-03-20';
const opponent = 'BOS';
// 14 games, oldest first; two short outings so the minutes-risk share is non-trivial
const games = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 1, 15 + i * 2));
  const short = i === 8 || i === 12;
  return {
    date: d.toISOString().slice(0, 10), pts: 18 + (i % 5) * 3, reb: 5 + (i % 3), ast: 3 + (i % 4), tpm: i % 4,
    minutes: short ? 19 : 31 + (i % 6), fga: 14 + (i % 4), fg3a: 5 + (i % 3), fgm: 7, fta: 4 + (i % 3),
    plus_minus: (i % 7) - 3, result: i % 3 ? 'W' : 'L', opponent: 'MIA', home: i % 2 === 0
  };
});
const propData = {
  line: 24.5, bookmaker_key: 'draftkings', over_odds: -115, under_odds: -105,
  all_bookmakers: [
    { bookmaker_key: 'draftkings', line: 24.5, over_odds: -115, under_odds: -105 },
    { bookmaker_key: 'fanduel', line: 24.5, over_odds: -110, under_odds: -110 },
    { bookmaker_key: 'pinnacle', line: 25.5, over_odds: -108, under_odds: -112 },
    { bookmaker_key: 'prizepicks', line: 25.0, over_odds: -137, under_odds: -137 }
  ]
};
// Opponent box scores: 6 games this season before the date, 1 after (must be ignored),
// 4 last season for shrinkage, and other teams for the league baseline
const row = (d, t, o, h, pts, opp, poss) => ({ e: `${d}-${t}`, d, t, o, h, pts, reb: 44, ast: 25, fg3m: 13, poss, opp_pts: opp, opp_reb: 46, opp_ast: 27, opp_fg3m: 14 });
const teamGameStats = {
  updated_at: '2026-10-19T00:00:00Z',
  seasons: {
    '2024-25': { games: [
      row('2024-11-01', 'BOS', 'NYK', 1, 110, 104, 98), row('2024-11-03', 'BOS', 'MIA', 0, 115, 112, 101),
      row('2024-11-05', 'BOS', 'LAL', 1, 99, 108, 96), row('2024-11-07', 'BOS', 'PHI', 0, 120, 118, 103),
      ...Array.from({ length: 120 }, (_, i) => row(`2024-12-${String(1 + (i % 28)).padStart(2, '0')}`, ['NYK', 'MIA', 'LAL', 'PHI'][i % 4] + i, 'X', i % 2, 112, 113 + (i % 5), 99 + (i % 3)))
    ] },
    '2025-26': { games: [
      row('2026-01-02', 'BOS', 'NYK', 1, 118, 101, 97), row('2026-01-04', 'BOS', 'MIA', 0, 109, 99, 95),
      row('2026-01-06', 'BOS', 'LAL', 1, 121, 110, 100), row('2026-02-01', 'BOS', 'PHI', 0, 104, 97, 94),
      row('2026-02-10', 'BOS', 'DEN', 1, 113, 108, 99), row('2026-03-19', 'BOS', 'CHI', 0, 116, 105, 98),
      row('2026-03-20', 'BOS', 'ORL', 1, 130, 140, 110), // the game itself: must not count
      ...Array.from({ length: 150 }, (_, i) => row(`2026-0${1 + (i % 2)}-${String(1 + (i % 28)).padStart(2, '0')}`, 'T' + (i % 29), 'X', i % 2, 114, 112 + (i % 7), 100 + (i % 4)))
    ] }
  }
};
const injuries = { playerTeamInjuries: [
  { playerName: 'Star Teammate', structuredStatus: 'out', impactScore: 92 },
  { playerName: 'Bench Guy', structuredStatus: 'out', impactScore: 40 },
  { playerName: 'Questionable Starter', structuredStatus: 'questionable', impactScore: 85 },
  { playerName: 'Test Player', structuredStatus: 'out', impactScore: 99 } // the player himself
] };

// ---- JavaScript side -------------------------------------------------------
const features = buildMLFeatures(games, 'PTS', { isHome: true, nextGameDate: `${gameDate}T23:30:00Z` });
const market = summarizeMarket(propData);
const opponentCtx = opponentContext(opponent, gameDate, teamGameStats);
const teammatesOutKey = injuries.playerTeamInjuries.filter(i => i.structuredStatus === 'out' && i.impactScore >= 80 && !i.playerName.toLowerCase().includes('player')).length;
const risk = { game_spread_abs: 6.5, teammates_out_key: teammatesOutKey };
const edgeRow = buildEdgeRow(features, 'points', propData.line, { market, opponent: opponentCtx, risk });

if (!edgeRow) fail('buildEdgeRow returned null');
if (opponentCtx.opp_games_n !== 6) fail(`opponent games before the date: expected 6, got ${opponentCtx.opp_games_n}`);
if (Math.abs(features.min_under25_share_10 - 0.2) > 1e-9) fail(`min_under25_share_10: expected 0.2, got ${features.min_under25_share_10}`);
if (market.n_books !== 4 || market.n_books_priced !== 2 || market.pinnacle_line !== 25.5) fail(`market summary wrong: ${JSON.stringify(market)}`);
if (teammatesOutKey !== 1) fail(`teammates_out_key: expected 1, got ${teammatesOutKey}`);
for (const [k, v] of Object.entries(edgeRow)) {
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) fail(`${k} is ${v}`);
}

// ---- Python rebuild of the same features ------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-lockstep-'));
const casePath = path.join(tmp, 'case.json');
fs.writeFileSync(casePath, JSON.stringify({
  row: edgeRow, prop: 'points', line: propData.line, feature_vector: features,
  context: { market, risk }, opponent, game_date: gameDate, team_game_stats: teamGameStats,
  minutes_oldest_first: games.map(g => g.minutes)
}));
const check = spawnSync('python3', [path.join(__dirname, 'edge_features.py'), '--check', casePath], { encoding: 'utf8' });
if (check.status !== 0) fail(`edge_features.py --check: ${check.stdout}${check.stderr}`);
const checked = JSON.parse(check.stdout.trim().split('\n').pop());
console.log(`features identical in JS and Python: ${checked.checked} checked`);

// ---- scoring with the saved edge model ------------------------------------
const score = spawnSync('python3', [path.join(__dirname, 'predict_xgboost.py'), JSON.stringify(features), 'PTS',
  path.join(__dirname, 'models'), JSON.stringify([edgeRow])], { encoding: 'utf8' });
if (score.status !== 0) fail(`predict_xgboost.py exited ${score.status}: ${score.stderr}`);
const result = JSON.parse(score.stdout);
if (result.errors?.EDGE) fail(`edge scoring error: ${result.errors.EDGE}`);
if (!Array.isArray(result.edge) || typeof result.edge[0] !== 'number') fail(`no edge residual in ${score.stdout}`);
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'models', 'edge_xgb_metadata.json'), 'utf8'));
const missing = meta.feature_names.filter(n => !(n in edgeRow));
if (missing.length) fail(`model features missing from the JS row: ${missing.join(', ')}`);
console.log(`edge model (${meta.feature_names.length} features, families ${JSON.stringify(meta.context_families || [])}) scored the row: residual ${result.edge[0].toFixed(3)}`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK');
