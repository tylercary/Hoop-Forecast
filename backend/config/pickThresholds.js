/**
 * Pick thresholds: the over probability at which the edge model turns a lean
 * into an OVER pick, and the one at or below which it becomes an UNDER pick.
 * Everything in between is shown as a lean.
 *
 * One place for the numbers so the prediction service, Best Bets and the
 * grading all agree. Override without a deploy through Railway variables:
 *   PICK_OVER_THRESHOLD   default 56
 *   PICK_UNDER_THRESHOLD  default 46
 * They are independent on purpose: the two sides have behaved differently
 * (unders calibrated, overs weaker) in both last season's held-out test and
 * the first live games, so the over bar may end up higher than 100 - under.
 *
 * The under bar moved from 44 to 46 on 2026-11-11. Graded Nov 1-8 (5,641
 * rows), unders the model put at 54-56% hit 58.1% (534 rows) while those at
 * 56% and up hit 52.8% (373 rows) and those at 62%+ hit 41%: a bigger gap
 * from the line is more often the book knowing something than the model.
 * At the old bar the picks ran 197/373; at this one they would have run
 * 507/907. The over bar is untouched because no over has qualified yet.
 */
function readThreshold(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

export const PICK_OVER = readThreshold('PICK_OVER_THRESHOLD', 56, 50, 95);
export const PICK_UNDER = readThreshold('PICK_UNDER_THRESHOLD', 46, 5, 50);

// Games a player must have logged THIS season before the model issues picks
// on him; until then his props are shown as leans. Opening week 2026-27 the
// model's picks ran 49% (overs 47%) with no slice above break-even: last
// season's logs do not describe this season's roles yet. 0 disables.
//   EARLY_SEASON_MIN_GAMES  default 5
export const EARLY_SEASON_MIN_GAMES = readThreshold('EARLY_SEASON_MIN_GAMES', 5, 0, 30);

/** OVER / UNDER / null for a calibrated over probability (0-100). */
export function pickFor(overProbability) {
  if (!Number.isFinite(overProbability)) return null;
  if (overProbability >= PICK_OVER) return 'OVER';
  if (overProbability <= PICK_UNDER) return 'UNDER';
  return null;
}
