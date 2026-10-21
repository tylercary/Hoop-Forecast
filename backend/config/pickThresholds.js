/**
 * Pick thresholds: the over probability at which the edge model turns a lean
 * into an OVER pick, and the one at or below which it becomes an UNDER pick.
 * Everything in between is shown as a lean.
 *
 * One place for the numbers so the prediction service, Best Bets and the
 * grading all agree. Override without a deploy through Railway variables:
 *   PICK_OVER_THRESHOLD   default 56
 *   PICK_UNDER_THRESHOLD  default 44
 * They are independent on purpose: the two sides have behaved differently
 * (unders calibrated, overs weaker) in both last season's held-out test and
 * the first live games, so the over bar may end up higher than 100 - under.
 */
function readThreshold(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

export const PICK_OVER = readThreshold('PICK_OVER_THRESHOLD', 56, 50, 95);
export const PICK_UNDER = readThreshold('PICK_UNDER_THRESHOLD', 44, 5, 50);

/** OVER / UNDER / null for a calibrated over probability (0-100). */
export function pickFor(overProbability) {
  if (!Number.isFinite(overProbability)) return null;
  if (overProbability >= PICK_OVER) return 'OVER';
  if (overProbability <= PICK_UNDER) return 'UNDER';
  return null;
}
