/**
 * Performance Tracking API Routes
 * Endpoints for model accuracy and hit rate tracking
 */

import express from 'express';
import * as performanceService from '../services/performanceTrackingService.js';

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

export { router as performanceRoutes };
