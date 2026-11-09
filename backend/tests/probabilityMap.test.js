import test from 'node:test';
import assert from 'node:assert/strict';
import { overProbabilityFromMap, PROB_FLOOR, PROB_CEILING } from '../ml/probabilityMap.js';

// The live map fitted 2026-10-31
const MAP = { intercept: -0.1164, coef_pos: 0.0533, coef_neg: 0.1587, coef_rel_pos: 0.1423, coef_rel_neg: -0.1279 };

test('a residual at the under cap is held at the floor', () => {
  // Luka Doncic points 34.5, residual -5.08: the unclamped map said 28.8
  assert.equal(overProbabilityFromMap(MAP, -5.08, 34.5), PROB_FLOOR);
});

test('moderate residuals pass through unchanged', () => {
  const p = overProbabilityFromMap(MAP, -1.5, 24.5);
  assert.ok(p > PROB_FLOOR && p < 50, `got ${p}`);
});

test('the result never leaves the floor..ceiling band', () => {
  for (const line of [1.5, 8.5, 24.5, 49.5]) {
    for (let r = -20; r <= 20; r += 0.5) {
      const p = overProbabilityFromMap(MAP, r, line);
      assert.ok(p >= PROB_FLOOR && p <= PROB_CEILING, `line ${line} residual ${r} gave ${p}`);
    }
  }
});

test('bad input still returns null', () => {
  assert.equal(overProbabilityFromMap(MAP, NaN, 20), null);
  assert.equal(overProbabilityFromMap(null, 1, 20), null);
});
