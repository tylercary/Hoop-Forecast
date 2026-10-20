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
  refreshFloorMs, planRefresh, PLAYER_VIEW_MAX_AGE_MS, REFRESH_SCHEDULE, dayKey
} = await import('../services/oddsEventCache.js');
const { CLOSING_REFRESH_MAX_AGE_MS, CLOSING_WINDOW_MS } = await import('../services/closingLineService.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-20T20:00:00Z');
const eventAt = (msFromNow) => ({ id: 'e1', commence_time: new Date(NOW + msFromNow).toISOString(), home_team: 'H', away_team: 'A' });
const cachedAgo = (ageMs) => ({ event: eventAt(0), data: { bookmakers: [{}] }, fetchedAt: NOW - ageMs });

test('refresh floor follows the time to tip-off', () => {
  assert.equal(refreshFloorMs(eventAt(20 * HOUR), NOW), 6 * HOUR);
  assert.equal(refreshFloorMs(eventAt(12 * HOUR), NOW), 2 * HOUR);
  assert.equal(refreshFloorMs(eventAt(5 * HOUR), NOW), 2 * HOUR);
  assert.equal(refreshFloorMs(eventAt(3 * HOUR), NOW), 45 * MIN);
  assert.equal(refreshFloorMs(eventAt(2 * HOUR), NOW), 45 * MIN);
  assert.equal(refreshFloorMs(eventAt(1 * HOUR), NOW), 15 * MIN);
  assert.equal(refreshFloorMs(eventAt(10 * MIN), NOW), 15 * MIN);
  assert.equal(refreshFloorMs(eventAt(0), NOW), Infinity);
  assert.equal(refreshFloorMs(eventAt(-30 * MIN), NOW), Infinity);
  assert.equal(refreshFloorMs({ id: 'x' }, NOW), REFRESH_SCHEDULE.at(-1).every, 'no tip time -> loosest floor');
});

test('background callers never refresh below the schedule floor', () => {
  // 5h out: floor 2h. A 90-minute-old copy is still fresh for background work...
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(90 * MIN), { maxAgeMs: 60 * MIN, now: NOW }).action, 'cached');
  // ...and expires once older than the floor
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(121 * MIN), { maxAgeMs: 60 * MIN, now: NOW }).action, 'fetch');
  // Nothing cached: fetch
  assert.equal(planRefresh(eventAt(5 * HOUR), undefined, { now: NOW }).action, 'fetch');
});

test('the game a user is viewing may read fresher than the schedule', () => {
  const plan = planRefresh(eventAt(5 * HOUR), cachedAgo(11 * MIN), { maxAgeMs: PLAYER_VIEW_MAX_AGE_MS, view: true, now: NOW });
  assert.equal(plan.action, 'fetch');
  assert.equal(planRefresh(eventAt(5 * HOUR), cachedAgo(9 * MIN), { maxAgeMs: PLAYER_VIEW_MAX_AGE_MS, view: true, now: NOW }).action, 'cached');
});

test('closing snapshot gets a read no older than 15 minutes in the last 20 minutes before tip', () => {
  // closingLineService asks for maxAgeMs = CLOSING_REFRESH_MAX_AGE_MS (15 min) for games
  // tipping within CLOSING_WINDOW_MS (20 min); inside the last hour the floor is 15 min too,
  // so the schedule never holds that request back
  assert.equal(CLOSING_REFRESH_MAX_AGE_MS, 15 * MIN);
  assert.equal(CLOSING_WINDOW_MS, 20 * MIN);
  for (const msToTip of [CLOSING_WINDOW_MS, 15 * MIN, 10 * MIN, 5 * MIN, 1 * MIN]) {
    const ev = eventAt(msToTip);
    assert.equal(refreshFloorMs(ev, NOW) <= CLOSING_REFRESH_MAX_AGE_MS, true, 'floor does not exceed the closing max age');
    assert.equal(planRefresh(ev, cachedAgo(CLOSING_REFRESH_MAX_AGE_MS + MIN), { maxAgeMs: CLOSING_REFRESH_MAX_AGE_MS, now: NOW }).action, 'fetch', `${msToTip / MIN}m to tip, 16m-old copy`);
    assert.equal(planRefresh(ev, cachedAgo(CLOSING_REFRESH_MAX_AGE_MS - MIN), { maxAgeMs: CLOSING_REFRESH_MAX_AGE_MS, now: NOW }).action, 'cached', `${msToTip / MIN}m to tip, 14m-old copy`);
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
  const plan = planRefresh(eventAt(30 * MIN), cachedAgo(HOUR), { maxAgeMs: 15 * MIN, now: NOW, quotaBlockedUntil: NOW + 5 * MIN });
  assert.deepEqual([plan.action, plan.reason], ['stale', 'quota-backoff']);
});

test('budget pause: background stops, views within 1h of tip still refresh', () => {
  const far = eventAt(5 * HOUR);
  const near = eventAt(40 * MIN);
  assert.equal(planRefresh(far, cachedAgo(3 * HOUR), { maxAgeMs: 15 * MIN, now: NOW, paused: true }).action, 'stale');
  assert.equal(planRefresh(near, cachedAgo(HOUR), { maxAgeMs: 15 * MIN, now: NOW, paused: true }).action, 'stale', 'background near tip still paused');
  assert.equal(planRefresh(far, cachedAgo(HOUR), { maxAgeMs: PLAYER_VIEW_MAX_AGE_MS, view: true, now: NOW, paused: true }).action, 'stale', 'view of a far game serves stale');
  assert.equal(planRefresh(near, cachedAgo(HOUR), { maxAgeMs: PLAYER_VIEW_MAX_AGE_MS, view: true, now: NOW, paused: true }).action, 'fetch', 'view near tip refreshes');
});

test('budget days roll over at 08:00 UTC so an NBA night is one day', () => {
  assert.equal(dayKey(Date.parse('2026-10-20T23:59:59Z')), '2026-10-20');
  assert.equal(dayKey(Date.parse('2026-10-21T03:30:00Z')), '2026-10-20', 'a late West-coast game still counts to the 20th');
  assert.equal(dayKey(Date.parse('2026-10-21T07:59:59Z')), '2026-10-20');
  assert.equal(dayKey(Date.parse('2026-10-21T08:00:00Z')), '2026-10-21');
});
