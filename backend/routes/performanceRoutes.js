/**
 * Performance Tracking API Routes
 * Endpoints for model accuracy and hit rate tracking
 */

import express from 'express';
import * as performanceService from '../services/performanceTrackingService.js';
import { resetPredictions, getRawPredictions } from '../services/predictionTrackingService.js';
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
    res.json(getRawPredictions({ offset, limit, includeFeatures, evaluatedOnly }));
  } catch (error) {
    console.error('Error exporting predictions:', error);
    res.status(500).json({ error: 'Failed to export predictions', message: error.message });
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
  try {
    const cleared = resetPredictions();
    res.json({ message: 'Predictions reset successfully', cleared });
  } catch (error) {
    console.error('Error resetting predictions:', error);
    res.status(500).json({ error: 'Failed to reset predictions', message: error.message });
  }
});

export { router as performanceRoutes };
