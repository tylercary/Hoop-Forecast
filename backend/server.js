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
import { resolveAllPendingPredictions } from './services/predictionCron.js';

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
      await evaluatePendingPredictions();
    }
  } catch (err) {
    console.error('Evaluation error:', err.message);
  }
}

// Run initial evaluation 30s after startup, then every 6 hours
setTimeout(runEvaluation, 30000);
setInterval(runEvaluation, EVAL_INTERVAL);

// Resolve ALL users' Firestore predictions every 15 minutes
const RESOLVE_INTERVAL = 15 * 60 * 1000;
setTimeout(() => resolveAllPendingPredictions().catch(() => {}), 60000);
setInterval(() => resolveAllPendingPredictions().catch(() => {}), RESOLVE_INTERVAL);

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
      return;
    }

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

  } catch (err) {
    console.error('Retrain error:', err.message);
  }
}

// Run retrain check 2 minutes after startup, then weekly
setTimeout(runRetrain, 120000);
setInterval(runRetrain, RETRAIN_INTERVAL);

// Pre-warm caches on startup so the first user request is fast
async function warmCaches() {
  try {
    const baseUrl = `http://localhost:${PORT}`;
    console.log('Warming caches...');
    await Promise.allSettled([
      fetch(`${baseUrl}/api/player/with-lines`).catch(() => {}),
      fetch(`${baseUrl}/api/trending/props`).catch(() => {})
    ]);
    console.log('Cache warm complete');
  } catch (err) {
    console.error('Cache warm error:', err.message);
  }
}

// Refresh caches every 10 minutes
const WARM_INTERVAL = 10 * 60 * 1000;

// Start server with error handling
app.listen(PORT, () => {
  console.log(`HoopForecast API running on http://localhost:${PORT}`);
  // Warm caches 5s after startup, then every 10 minutes
  setTimeout(warmCaches, 5000);
  setInterval(warmCaches, WARM_INTERVAL);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Run: lsof -ti:${PORT} | xargs kill -9`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

