/**
 * Performance Tracking API Routes
 * Endpoints for model accuracy and hit rate tracking
 */

import express from 'express';
import * as performanceService from '../services/performanceTrackingService.js';
import { resetPredictions, getRawPredictions, getAllPredictions, archiveLegacyPredictions, listArchives } from '../services/predictionTrackingService.js';
import { archiveGamePredictions } from '../services/gamePredictionTrackingService.js';
import { runBackup, latestBackup, listBackups, getBackupStatus } from '../services/backupService.js';

// Destructive routes need ADMIN_KEY (env) in the x-admin-key header; with no
// ADMIN_KEY configured they are disabled.
function requireAdmin(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || req.get('x-admin-key') !== key) {
    res.status(403).json({ error: 'Admin key required' });
    return false;
  }
  return true;
}
import { gradeEdgePredictions } from '../services/edgeGradingService.js';
import { getGamePredictionStats } from '../services/gamePredictionTrackingService.js';

const router = express.Router();

/**
 * GET /api/performance
 * Get overall performance metrics
 */
router.get('/', async (req, res) => {
  try {
    const performance = performanceService.calculatePerformance();
    res.json(performance);
  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch performance metrics',
      message: error.message
    });
  }
});

/**
 * GET /api/performance/player/:playerName
 * Get predictions for a specific player
 */
router.get('/player/:playerName', async (req, res) => {
  try {
    const { playerName } = req.params;
    const predictions = performanceService.getPlayerPredictions(playerName);
    res.json({ playerName, predictions, total: predictions.length });
  } catch (error) {
    console.error('Error fetching player predictions:', error);
    res.status(500).json({
      error: 'Failed to fetch player predictions',
      message: error.message
    });
  }
});

/**
 * GET /api/performance/date/:date
 * Get predictions for a specific date (YYYY-MM-DD)
 */
router.get('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const predictions = performanceService.getPredictionsByDate(date);
    res.json({ date, predictions, total: predictions.length });
  } catch (error) {
    console.error('Error fetching predictions by date:', error);
    res.status(500).json({
      error: 'Failed to fetch predictions by date',
      message: error.message
    });
  }
});

/**
 * GET /api/performance/export?offset=0&limit=1000&evaluated=1&features=0
 * Raw prediction records, paginated, for offline calibration and retraining.
 * Feature vectors are included only with features=1 (they are large).
 */
router.get('/export', (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));
    const includeFeatures = req.query.features === '1';
    const evaluatedOnly = req.query.evaluated !== '0';
    const source = req.query.source === 'archive' ? 'archive' : 'live';
    res.json(getRawPredictions({ offset, limit, includeFeatures, evaluatedOnly, source }));
  } catch (error) {
    console.error('Error exporting predictions:', error);
    res.status(500).json({ error: 'Failed to export predictions', message: error.message });
  }
});

/**
 * GET /api/performance/edge?variant=edge&version=current
 * How the edge model's live picks have graded out: hit rates, stated vs
 * realised over probability, leans, calibration, per prop and per ISO week.
 * Same summary as backend/scripts/gradeEdgeModel.mjs; recomputed from the
 * in-memory store at most every 10 minutes per variant+version.
 *
 * version=current (default) grades only rows made by the model version that
 * is running now; earlier versions come back summarised in `other_versions`.
 * version=all mixes every version; version=<stamp> grades that one.
 */
const EDGE_GRADING_TTL_MS = 10 * 60 * 1000;
const EDGE_VARIANTS = new Set(['edge', 'anchored', 'legacy', 'all']);
const edgeGradingCache = new Map(); // variant|version -> { at, summary }

router.get('/edge', (req, res) => {
  try {
    const variant = EDGE_VARIANTS.has(req.query.variant) ? req.query.variant : 'edge';
    const version = typeof req.query.version === 'string' && /^[\w.-]{1,40}$/.test(req.query.version) ? req.query.version : 'current';
    const key = `${variant}|${version}`;
    const hit = edgeGradingCache.get(key);
    if (!hit || Date.now() - hit.at > EDGE_GRADING_TTL_MS) {
      const summary = gradeEdgePredictions(getAllPredictions(), { variant, version });
      edgeGradingCache.set(key, { at: Date.now(), summary });
    }
    const { at, summary } = edgeGradingCache.get(key);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ ...summary, cached_at: new Date(at).toISOString() });
  } catch (error) {
    console.error('Error grading edge model:', error);
    res.status(500).json({ error: 'Failed to grade edge model', message: error.message });
  }
});

/**
 * GET /api/performance/games
 * Get game prediction performance metrics
 */
router.get('/games', async (req, res) => {
  try {
    const stats = getGamePredictionStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching game prediction stats:', error);
    res.status(500).json({ error: 'Failed to fetch game prediction stats', message: error.message });
  }
});

/**
 * POST /api/performance/cleanup
 * Clean up old predictions (>90 days)
 */
router.post('/cleanup', async (req, res) => {
  try {
    const deletedCount = performanceService.cleanupOldPredictions();
    res.json({
      message: 'Cleanup completed successfully',
      deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up predictions:', error);
    res.status(500).json({
      error: 'Failed to cleanup predictions',
      message: error.message
    });
  }
});

/**
 * POST /api/performance/reset
 * Reset all predictions (for model version changes)
 */
router.post('/reset', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cleared = resetPredictions();
    res.json({ message: 'Predictions reset successfully', cleared });
  } catch (error) {
    console.error('Error resetting predictions:', error);
    res.status(500).json({ error: 'Failed to reset predictions', message: error.message });
  }
});

/**
 * POST /api/performance/archive-legacy  (x-admin-key)
 * Move every non-edge prediction and all game predictions into archive files.
 */
router.post('/archive-legacy', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const props = archiveLegacyPredictions();
    const games = archiveGamePredictions();
    res.json({ props, games, archives: listArchives() });
  } catch (error) {
    console.error('Error archiving predictions:', error);
    res.status(500).json({ error: 'Failed to archive predictions', message: error.message });
  }
});

/**
 * GET /api/performance/backup  (x-admin-key)
 * Stream the latest SQLite backup of the prediction store so it can be pulled
 * off the volume by hand or by a workflow. ?fresh=1 writes a new copy first;
 * with no backup on the volume yet one is written anyway. ?list=1 returns
 * what is on the volume instead of a file.
 */
router.get('/backup', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.query.list === '1') {
      return res.json({ ...getBackupStatus(), backups: listBackups() });
    }
    let backup = req.query.fresh === '1' ? null : latestBackup();
    if (!backup) {
      await runBackup({ upload: false });
      backup = latestBackup();
    }
    if (!backup) return res.status(500).json({ error: 'No backup available' });
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Length', String(backup.size));
    res.set('Content-Disposition', `attachment; filename="${backup.name}"`);
    res.set('X-Backup-Name', backup.name);
    res.set('Cache-Control', 'no-store');
    res.sendFile(backup.file);
  } catch (error) {
    console.error('Error serving backup:', error);
    res.status(500).json({ error: 'Failed to produce backup', message: error.message });
  }
});

export { router as performanceRoutes };
