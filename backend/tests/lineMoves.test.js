/**
 * Line-move detection on a fake odds refresh, and the debounce queue that
 * turns a burst of moves into one re-prediction run per player.
 * Run: npm --prefix backend test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-cache-test-'));
process.env.ODDS_API_KEY = process.env.ODDS_API_KEY || 'test-key';

const { consensusLines, diffEventLines } = await import('../services/oddsEventCache.js');
const { createLineMoveQueue } = await import('../services/lineMoveQueue.js');

// Build an Odds API event payload from { book: { market: [[player, line, overPrice, underPrice], ...] } }
function payload(books) {
  return {
    bookmakers: Object.entries(books).map(([key, markets]) => ({
      key,
      markets: Object.entries(markets).map(([market, rows]) => ({
        key: market,
        outcomes: rows.flatMap(([player, line, over = -110, under = -110]) => [
          { name: 'Over', description: player, point: line, price: over },
          { name: 'Under', description: player, point: line, price: under }
        ])
      }))
    }))
  };
}

const before = payload({
  fanduel: { player_points: [['Jayson Tatum', 27.5], ['Jaylen Brown', 22.5]], player_assists: [['Jayson Tatum', 4.5]] },
  draftkings: { player_points: [['Jayson Tatum', 27.5], ['Jaylen Brown', 22.5]], player_assists: [['Jayson Tatum', 4.5]] },
  betmgm: { player_points: [['Jayson Tatum', 28.5], ['Jaylen Brown', 22.5]] },
  prizepicks: { player_points: [['Jayson Tatum', 29.5], ['Payton Pritchard', 11.5]] }
});

test('consensus line is the most common sportsbook main line; alternates and DFS do not sway it', () => {
  const lines = consensusLines(before);
  assert.equal(lines.get('jayson tatum|points').line, 27.5);
  assert.equal(lines.get('jaylen brown|points').line, 22.5);
  assert.equal(lines.get('jayson tatum|assists').line, 4.5);
  // Only a DFS site posts Pritchard: it counts when no sportsbook does
  assert.equal(lines.get('payton pritchard|points').line, 11.5);

  // Alternate lines (priced far from even) do not become a book's main line
  const withAlts = payload({
    fanduel: { player_points: [['Jayson Tatum', 27.5, -112, -108], ['Jayson Tatum', 32.5, +260, -340], ['Jayson Tatum', 22.5, -380, +280]] }
  });
  assert.equal(consensusLines(withAlts).get('jayson tatum|points').line, 27.5);
});

test('a refresh diff reports moved, pulled and newly posted props and nothing else', () => {
  const after = payload({
    fanduel: { player_points: [['Jayson Tatum', 28.5], ['Jaylen Brown', 22.5]], player_assists: [['Jayson Tatum', 4.5]], player_rebounds: [['Jaylen Brown', 5.5]] },
    draftkings: { player_points: [['Jayson Tatum', 28.5], ['Jaylen Brown', 22.5]] },  // DK pulled Tatum assists
    betmgm: { player_points: [['Jayson Tatum', 28.5], ['Jaylen Brown', 22.5]] },
    prizepicks: { player_points: [['Jayson Tatum', 29.5]] }                              // Pritchard pulled everywhere
  });
  const changes = diffEventLines(before, after).sort((a, b) => `${a.player}|${a.prop}`.localeCompare(`${b.player}|${b.prop}`));
  assert.deepEqual(changes, [
    { player: 'Jaylen Brown', prop: 'rebounds', oldLine: null, newLine: 5.5 },
    { player: 'Jayson Tatum', prop: 'points', oldLine: 27.5, newLine: 28.5 },
    { player: 'Payton Pritchard', prop: 'points', oldLine: 11.5, newLine: null }
  ]);
  // Tatum assists still has a consensus of 4.5 (FanDuel), so it is not reported
  assert.equal(changes.some(c => c.prop === 'assists'), false);
  assert.deepEqual(diffEventLines(before, before), []);
});

test('the queue coalesces a burst of moves into one run per player and reruns for moves that land mid-run', async () => {
  // Fake clock: timers fire only when we say so
  const timers = [];
  const setTimer = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
  const clearTimer = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  const fire = async () => { const t = timers.shift(); t.fn(); await new Promise(r => setImmediate(r)); };

  const runs = [];
  let release;
  const run = (names) => { runs.push(names); return new Promise(r => { release = r; }); };
  const q = createLineMoveQueue({ run, delayMs: 30000, setTimer, clearTimer, log: { error() {} } });

  // Three refreshes within the debounce window: BOS game twice, then NYK
  q.add(['Jayson Tatum', 'Jaylen Brown']);
  q.add(['Jayson Tatum']);
  q.add(['Jalen Brunson']);
  assert.equal(timers.length, 1, 'one pending timer for the whole burst');
  assert.equal(timers[0].ms, 30000);
  assert.equal(q.size, 3);

  await fire();
  assert.deepEqual(runs, [['Jayson Tatum', 'Jaylen Brown', 'Jalen Brunson']]);
  assert.equal(q.running, true);

  // A move during the run is not lost: it gets a fresh debounced run afterwards
  q.add(['Karl-Anthony Towns']);
  assert.equal(timers.length, 0, 'no timer while a run is in progress');
  release({ players: 3 });
  await new Promise(r => setImmediate(r));
  assert.equal(q.running, false);
  assert.equal(timers.length, 1, 'the mid-run move scheduled the next run');
  await fire();
  assert.deepEqual(runs[1], ['Karl-Anthony Towns']);
  release({ players: 1 });
  await new Promise(r => setImmediate(r));
  assert.equal(await q.flush(), null, 'nothing left to run');
});
