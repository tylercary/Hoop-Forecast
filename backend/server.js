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
import { gamesRoutes } from './routes/gamesRoutes.js';
import { testInjuryRouter } from './routes/testInjuryRoute.js';
import { evaluatePendingPredictions } from './services/predictionEvaluationService.js';
import { getAccuracyStats, getStoreStatus } from './services/predictionTrackingService.js';
import { scheduleBackups, getBackupStatus } from './services/backupService.js';
import { evaluatePendingGamePredictions } from './services/gamePredictionTrackingService.js';
import optionalAuth from './middleware/optionalAuth.js';
import { resolveAllPendingPredictions } from './services/predictionCron.js';
import { teamGameStatsSummary } from './services/teamContextService.js';
import { archiveLegacyPredictions, dedupeGamePredictions } from './services/predictionTrackingService.js';
import { archiveGamePredictions } from './services/gamePredictionTrackingService.js';
import { runBatchPredictions, runBatchGamePredictions, ensureSlatePredicted } from './services/batchPredictionCron.js';
import { getOddsApiUsage, startOddsRefreshLoop } from './services/oddsEventCache.js';
import { runClosingSnapshotsOnce, CLOSING_JOB_INTERVAL_MS } from './services/closingLineService.js';

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

// Health check route. commit is set by Railway for deploys from GitHub,
// so it shows which commit production is actually running.
const startedAt = new Date().toISOString();
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'HoopForecast API is running',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
    startedAt,
    oddsApi: getOddsApiUsage(),
    teamStats: teamGameStatsSummary(),
    store: storeHealth()
  });
});

// Prediction store: engine, row count, file size and when it was last backed up
function storeHealth() {
  try {
    const { engine, rows, db_size_mb } = getStoreStatus();
    const backup = getBackupStatus();
    return { engine, rows, db_size_mb, last_backup_at: backup.last_backup_at, backup_targets: backup.targets, backup_error: backup.last_error };
  } catch (error) {
    return { engine: 'sqlite', error: error.message };
  }
}

// API routes
app.use('/api/player', playerRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/test', testInjuryRouter);
app.use('/api/performance', performanceRoutes);
app.use('/api/games', gamesRoutes);

// Automatic prediction evaluation scheduler
// Runs every 6 hours to evaluate predictions whose games have been played
const EVAL_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

async function runEvaluation() {
  try {
    const stats = getAccuracyStats();
    console.log(`[Eval] Checking: ${stats.pending || 0} pending, ${stats.evaluated || 0} evaluated`);
    if (stats.pending > 0) {
      const result = await evaluatePendingPredictions();
      console.log(`[Eval] Complete: ${result.evaluated} evaluated, ${result.failed} failed, ${result.skipped} skipped`);
    }

    // Also evaluate game predictions
    const gameResult = await evaluatePendingGamePredictions();
    if (gameResult.evaluated > 0) {
      console.log(`[Eval] Game predictions: ${gameResult.evaluated} evaluated, ${gameResult.failed} failed`);
    }
  } catch (err) {
    console.error('Evaluation error:', err.message);
  }
}

// Run initial evaluation 30s after startup, then every 6 hours
// One-time reset for the edge model (2026-10-20): predictions from earlier
// models and all old game predictions leave the live store for archive files,
// so the performance page and Best Bets describe only the current model.
// Idempotent; the archives remain readable via /api/performance/export?source=archive.
try {
  archiveLegacyPredictions();
  archiveGamePredictions();
  // One record per player/prop/game, ISO-dated: legacy "Oct 20, 2026" rows
  // stored beside "2026-10-20" rows for the same game would be graded twice.
  dedupeGamePredictions();
} catch (err) {
  console.error('Legacy archive failed:', err.message);
}

setTimeout(runEvaluation, 30000);
setInterval(runEvaluation, EVAL_INTERVAL);

// Nightly off-volume backup of the prediction store (~09:00 UTC; see backupService.js)
scheduleBackups();

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

// Daily batch predictions — generate predictions for ALL players with active lines
// (combos whose stored prediction is older than 3 hours or whose line moved).
// Every 2 hours; at startup the slate is warmed once the odds cache is ready
// (see app.listen) so Best Bets has rows right away, using the shared cache
// rather than fresh Odds API calls.
const BATCH_PREDICT_INTERVAL = 2 * 60 * 60 * 1000;
setInterval(() => runBatchPredictions().catch(err => console.error('Batch prediction error:', err.message)), BATCH_PREDICT_INTERVAL);

// Game prediction batch — every 6 hours, generate game predictions for all
// scheduled games so the tracker accumulates data automatically.
const BATCH_GAME_INTERVAL = 6 * 60 * 60 * 1000;
setTimeout(() => runBatchGamePredictions().catch(err => console.error('Batch game prediction error:', err.message)), 180000);
setInterval(() => runBatchGamePredictions().catch(err => console.error('Batch game prediction error:', err.message)), BATCH_GAME_INTERVAL);

// Closing line snapshots — every 5 minutes, record the market for tracked
// predictions whose game tips off within the next 20 minutes (and once more
// right after tip-off as a safety net). Idempotent: a record's `closing` is
// set once. Reads the shared odds cache; refreshes a game at most once when
// its cached odds are older than 15 minutes. The first run waits for the
// startup cache warm so it does not pay for the slate twice.
setTimeout(() => runClosingSnapshotsOnce(), 45000);
setInterval(() => runClosingSnapshotsOnce(), CLOSING_JOB_INTERVAL_MS);

// Pre-warm caches on startup so the first user request is fast. The odds
// cache is loaded from DATA_DIR/odds_cache.json first, so this only pays for
// games whose cached odds are older than the tip-off schedule allows.
async function warmCaches() {
  try {
    const baseUrl = `http://localhost:${PORT}`;
    console.log('Warming caches...');
    await Promise.allSettled([
      fetch(`${baseUrl}/api/player/with-lines`).catch(() => {}),
      fetch(`${baseUrl}/api/trending/props`).catch(() => {}),
      fetch(`${baseUrl}/api/trending/best-bets`).catch(() => {})
    ]);
    console.log('Cache warm complete');
  } catch (err) {
    console.error('Cache warm error:', err.message);
  }
}

// Refresh the derived route caches every 10 minutes (the odds themselves
// follow the refresh loop above)
const WARM_INTERVAL = 10 * 60 * 1000;

// Start server with error handling
app.listen(PORT, () => {
  console.log(`HoopForecast API running on http://localhost:${PORT}`);
  // Keep every slate game's odds on the tip-off schedule (down to every 2 min
  // in the last 15 minutes before tip) whether or not anyone is browsing
  startOddsRefreshLoop();
  // Warm caches 5s after startup, then every 10 minutes
  setTimeout(warmCaches, 5000);
  setInterval(warmCaches, WARM_INTERVAL);
  // Predict the slate once the odds cache has been filled by the warm above.
  // No-op when the store already holds today's rows (e.g. a quick restart).
  setTimeout(() => ensureSlatePredicted().catch(err => console.error('Slate warm error:', err.message)), 20000);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Run: lsof -ti:${PORT} | xargs kill -9`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

