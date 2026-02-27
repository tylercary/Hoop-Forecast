import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { playerRoutes } from './routes/playerRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js';
import { trendingRoutes } from './routes/trendingRoutes.js';
import { performanceRoutes } from './routes/performanceRoutes.js';
import { testInjuryRouter } from './routes/testInjuryRoute.js';
import { evaluatePendingPredictions } from './services/predictionEvaluationService.js';
import { getAccuracyStats } from './services/predictionTrackingService.js';
import optionalAuth from './middleware/optionalAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(optionalAuth);

// Serve static files (player images and sportsbook logos)
app.use('/images', express.static(path.join(__dirname, 'public/images'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Set correct content-type for SVG files (even if they have .png extension)
    if (filePath.endsWith('.png')) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.trim().startsWith('<svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
        }
      } catch (e) {
        // If we can't read it, let express handle it
      }
    }
  }
}));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'HoopForecast API is running' });
});

// API routes
app.use('/api/player', playerRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/test', testInjuryRouter);
app.use('/api/performance', performanceRoutes);

// Automatic prediction evaluation scheduler
// Runs every 6 hours to evaluate predictions whose games have been played
const EVAL_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

async function runEvaluation() {
  try {
    const stats = getAccuracyStats();
    if (stats.pending > 0) {
      console.log(`\n🔄 [SCHEDULER] Evaluating ${stats.pending} pending predictions...`);
      const result = await evaluatePendingPredictions();
      console.log(`✅ [SCHEDULER] Evaluation done: ${result.evaluated} evaluated, ${result.failed} failed, ${result.skipped} skipped`);
    }
  } catch (err) {
    console.error('❌ [SCHEDULER] Evaluation error:', err.message);
  }
}

// Run initial evaluation 30s after startup, then every 6 hours
setTimeout(runEvaluation, 30000);
setInterval(runEvaluation, EVAL_INTERVAL);

// Weekly auto-retrain scheduler
// Retrains XGBoost models using prediction feedback data
const RETRAIN_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function runRetrain() {
  try {
    // Only retrain if we have enough new evaluated predictions
    const stats = getAccuracyStats();
    const retrainLogPath = path.join(__dirname, 'data', 'retrain_log.json');
    let lastRetrainEvaluated = 0;
    try {
      if (fs.existsSync(retrainLogPath)) {
        const log = JSON.parse(fs.readFileSync(retrainLogPath, 'utf8'));
        lastRetrainEvaluated = log.lastEvaluatedCount || 0;
      }
    } catch (e) { /* ignore */ }

    const newEvaluations = (stats.evaluated || 0) - lastRetrainEvaluated;
    if (newEvaluations < 20) {
      console.log(`[RETRAIN] Only ${newEvaluations} new evaluations since last retrain (need 20+). Skipping.`);
      return;
    }

    console.log(`\n[RETRAIN] ${newEvaluations} new evaluations. Starting incremental retrain...`);

    const { execSync } = await import('child_process');
    execSync('node backend/scripts/retrainFromTracking.js --incremental', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      timeout: 600000
    });

    // Update the retrain log with current evaluated count
    try {
      const log = fs.existsSync(retrainLogPath)
        ? JSON.parse(fs.readFileSync(retrainLogPath, 'utf8'))
        : {};
      log.lastEvaluatedCount = stats.evaluated || 0;
      fs.writeFileSync(retrainLogPath, JSON.stringify(log, null, 2), 'utf8');
    } catch (e) { /* ignore */ }

    console.log('[RETRAIN] Retrain complete.');
  } catch (err) {
    console.error('[RETRAIN] Retrain error:', err.message);
  }
}

// Run retrain check 2 minutes after startup, then weekly
setTimeout(runRetrain, 120000);
setInterval(runRetrain, RETRAIN_INTERVAL);

// Start server with error handling
app.listen(PORT, () => {
  console.log(`🏀 HoopForecast API server running on http://localhost:${PORT}`);
  const stats = getAccuracyStats();
  console.log(`📊 Prediction tracker: ${stats.total_predictions || 0} total, ${stats.evaluated || 0} evaluated, ${stats.pending || 0} pending`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error(`💡 Try one of these solutions:`);
    console.error(`   1. Kill the process: lsof -ti:${PORT} | xargs kill -9`);
    console.error(`   2. Use a different port: PORT=5001 npm run dev`);
    console.error(`   3. Check what's using the port: lsof -i:${PORT}`);
  } else {
    console.error('❌ Server error:', err);
  }
  process.exit(1);
});

