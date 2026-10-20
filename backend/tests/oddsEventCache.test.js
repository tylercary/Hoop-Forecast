/**
 * Tip-off schedule and budget decisions of the shared odds cache, with fake
 * clocks and no network. Run: npm --prefix backend test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Keep the module from reading the real DATA_DIR/odds_cache.json
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-cache-test-'));
process.env.ODDS_API_KEY = process.env.ODDS_API_KEY || 'test-key';

const {
  refreshFloorMs, planRefresh, viewMaxAgeMs, VIEW_MAX_AGE, REFRESH_SCHEDULE, dayKey
} = await import('../services/oddsEventCache.js');
const { CLOSING_REFRESH_MAX_AGE_MS, CLOSING_WINDOW_MS } = await import('../services/closingLineService.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-20T20:00:00Z');
const eventAt = (msFromNow) => ({ id: 'e1', commence_time: new Date(NOW + msFromNow).toISOString(), home_team: 'H', away_team: 'A' });
const cachedAgo = (ageMs) => ({ event: eventAt(0), data: { bookmakers: [{}] }, fetchedAt: NOW - ageMs });

test('refresh floor follows the time to tip-off', () => {
  assert.equal(refreshFloorMs(eventAt(30 * HOUR), NOW), 3 * HOUR);
  assert.equal(refreshFloorMs(eventAt(24 * HOUR), NOW), 60 * MIN);
  assert.equal(refreshFloorMs(eventAt(12 * HOUR), NOW), 60 * MIN);
  assert.equal(refreshFloorMs(eventAt(6 * HOUR), NOW), 20 * MIN);
  assert.equal(refreshFloorMs(eventAt(3 * HOUR), NOW), 20 * MIN);
  assert.equal(refreshFloorMs(eventAt(2 * HOUR), NOW), 10 * MIN);
  assert.equal(refreshFloorMs(eventAt(90 * MIN), NOW), 10 * MIN);
  assert.equal(refreshFloorMs(eventAt(1 * HOUR), NOW), 5 * MIN);
  assert.equal(refreshFloorMs(eventAt(20 * MIN), NOW), 5 * MIN);
  assert.equal(refreshFloorMs(eventAt(15 * MIN), NOW), 2 * MIN);
  assert.equal(refreshFloorMs(eventAt(1 * MIN), NOW), 2 * MIN);
  assert.equal(refreshFloorMs(eventAt(0), NOW), Infinity);
  assert.equal(refreshFloorMs(eventAt(-30 * MIN), NOW), Infinity);
  assert.equal(refreshFloorMs({ id: 'x' }, NOW), REFRESH_SCHEDULE.at(-1).every, 'no tip time -> loosest floor');
});

test('background callers never refresh below the schedule floor', () => {
  // 5h out: floor 20 min. A 15-minute-old copy is still fresh even when the caller asks for 5 min...
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(15 * MIN), { maxAgeMs: 5 * MIN, now: NOW }).action, 'cached');
  // ...and expires once older than the floor
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(21 * MIN), { maxAgeMs: 5 * MIN, now: NOW }).action, 'fetch');
  // Nothing cached: fetch
  assert.equal(planRefresh(eventAt(5 * HOUR), undefined, { now: NOW }).action, 'fetch');
});

test('the default (no maxAgeMs) is exactly the schedule floor', () => {
  // The refresh loop and every slate consumer call with defaults, so the
  // floor must bite: 30h out (3h floor), 5h out (20 min), 30 min out (5 min), 10 min out (2 min)
  for (const [msToTip, floor] of [[30 * HOUR, 3 * HOUR], [5 * HOUR, 20 * MIN], [30 * MIN, 5 * MIN], [10 * MIN, 2 * MIN]]) {
    assert.equal(planRefresh(eventAt(msToTip), cachedAgo(floor - 1000), { now: NOW }).action, 'cached', `${msToTip / MIN}m to tip: just under the floor`);
    assert.equal(planRefresh(eventAt(msToTip), cachedAgo(floor + 1000), { now: NOW }).action, 'fetch', `${msToTip / MIN}m to tip: just over the floor`);
  }
});

test('the game a user is viewing may read fresher than the schedule', () => {
  // Far game (10h out, floor 60 min): a view refreshes at 10 min
  assert.equal(viewMaxAgeMs(eventAt(10 * HOUR), NOW), VIEW_MAX_AGE.far);
  assert.equal(planRefresh(eventAt(10 * HOUR), cachedAgo(11 * MIN), { view: true, now: NOW }).action, 'fetch');
  assert.equal(planRefresh(eventAt(10 * HOUR), cachedAgo(9 * MIN), { view: true, now: NOW }).action, 'cached');
  // Near game (5h out, floor 20 min): a view refreshes at 3 min
  assert.equal(viewMaxAgeMs(eventAt(5 * HOUR), NOW), VIEW_MAX_AGE.near);
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(4 * MIN), { view: true, now: NOW }).action, 'fetch');
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(2 * MIN), { view: true, now: NOW }).action, 'cached');
  // An explicit maxAgeMs on a view is honoured as given
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(4 * MIN), { maxAgeMs: 10 * MIN, view: true, now: NOW }).action, 'cached');
});

test('closing snapshot reads a market no older than the schedule floor near tip', () => {
  // closingLineService asks for maxAgeMs = CLOSING_REFRESH_MAX_AGE_MS (15 min) for games
  // tipping within CLOSING_WINDOW_MS (20 min). The floor there is 5 min, then 2 min in
  // the last 15 min, and the refresh loop keeps the cache at the floor, so the
  // snapshot sees a read at most a couple of minutes old; the closing request itself
  // is never held back by the schedule.
  assert.equal(CLOSING_REFRESH_MAX_AGE_MS, 15 * MIN);
  assert.equal(CLOSING_WINDOW_MS, 20 * MIN);
  for (const msToTip of [CLOSING_WINDOW_MS, 15 * MIN, 10 * MIN, 5 * MIN, 1 * MIN]) {
    const ev = eventAt(msToTip);
    const floor = refreshFloorMs(ev, NOW);
    assert.equal(floor <= 5 * MIN, true, `${msToTip / MIN}m to tip: floor ${floor / MIN}m`);
    // what the loop does: a copy just past the floor is refreshed
    assert.equal(planRefresh(ev, cachedAgo(floor + 1000), { now: NOW }).action, 'fetch');
    // what the closing job does: a stale copy is refreshed, a floor-fresh one is served
    assert.equal(planRefresh(ev, cachedAgo(CLOSING_REFRESH_MAX_AGE_MS + MIN), { maxAgeMs: CLOSING_REFRESH_MAX_AGE_MS, now: NOW }).action, 'fetch');
    assert.equal(planRefresh(ev, cachedAgo(floor - 1000), { maxAgeMs: CLOSING_REFRESH_MAX_AGE_MS, now: NOW }).action, 'cached');
  }
});

test('after tip-off nothing is fetched and the last snapshot is served', () => {
  const started = eventAt(-10 * MIN);
  const plan = planRefresh(started, cachedAgo(3 * HOUR), { maxAgeMs: 15 * MIN, now: NOW });
  assert.equal(plan.action, 'cached');
  assert.equal(plan.reason, 'tipped-off');
  // Even a view does not refetch a game in progress
  assert.equal(planRefresh(started, cachedAgo(3 * HOUR), { maxAgeMs: 1, view: true, now: NOW }).action, 'cached');
  assert.equal(planRefresh(started, undefined, { now: NOW }).action, 'stale');
});

test('quota backoff serves stale', () => {
  const plan = planRefresh(eventAt(30 * MIN), cachedAgo(HOUR), { now: NOW, quotaBlockedUntil: NOW + 5 * MIN });
  assert.deepEqual([plan.action, plan.reason], ['stale', 'quota-backoff']);
});

test('budget pause: background stops, views within 1h of tip still refresh', () => {
  const far = eventAt(5 * HOUR);
  const near = eventAt(40 * MIN);
  assert.equal(planRefresh(far, cachedAgo(3 * HOUR), { now: NOW, paused: true }).action, 'stale');
  assert.equal(planRefresh(near, cachedAgo(HOUR), { now: NOW, paused: true }).action, 'stale', 'background near tip still paused');
  assert.equal(planRefresh(far, cachedAgo(HOUR), { view: true, now: NOW, paused: true }).action, 'stale', 'view of a far game serves stale');
  assert.equal(planRefresh(near, cachedAgo(HOUR), { view: true, now: NOW, paused: true }).action, 'fetch', 'view near tip refreshes');
});

test('budget days roll over at 08:00 UTC so an NBA night is one day', () => {
  assert.equal(dayKey(Date.parse('2026-10-20T23:59:59Z')), '2026-10-20');
  assert.equal(dayKey(Date.parse('2026-10-21T03:30:00Z')), '2026-10-20', 'a late West-coast game still counts to the 20th');
  assert.equal(dayKey(Date.parse('2026-10-21T07:59:59Z')), '2026-10-20');
  assert.equal(dayKey(Date.parse('2026-10-21T08:00:00Z')), '2026-10-21');
});
