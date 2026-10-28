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
 */
export const MODEL_VERSION = '2026-10-25-calib1';
