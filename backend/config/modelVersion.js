/**
 * The prediction logic's version stamp, stored on every prediction.
 *
 * Bumped whenever the model, calibration or pick rules change, so that
 *   - the slate batch re-predicts stored rows made by an older version, and
 *   - the live record (GET /api/performance/edge) grades only the version that
 *     is running now; earlier versions are reported separately.
 *
 * History:
 *   2026-10-25-calib1  probabilities shrunk to this season's measured
 *                      calibration, picks held until five games this season
 *   2026-10-31-livemap1 residual -> P(over) map refit on this season's 8,023
 *                      graded rows with separate over/under slopes; the
 *                      pooled 0.2 shrink retired (the map is calibrated itself)
 *   2026-11-09-clamp1  stated probability held to 38-62: the map's tail
 *                      claimed 70%+ where graded rows hit about 58-60. Picks
 *                      and thresholds unchanged
 */
export const MODEL_VERSION = '2026-11-09-clamp1';

/**
 * Versions whose picks the running version would also have made: a change to
 * how a probability is displayed, not to what is picked. The live record
 * grades these together with MODEL_VERSION, so the record does not restart
 * when nothing about the picks changed. Clear it on any change to the model,
 * the map's slopes or the thresholds.
 */
export const RECORD_CONTINUES_FROM = ['2026-10-31-livemap1'];
export const CURRENT_RECORD_VERSIONS = new Set([MODEL_VERSION, ...RECORD_CONTINUES_FROM]);
