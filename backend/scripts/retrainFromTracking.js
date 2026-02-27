/**
 * XGBoost Retraining Orchestrator
 *
 * End-to-end pipeline:
 * 1. Builds per-prop training sets from evaluated predictions (build_training_set.py)
 * 2. Refreshes feature engineering from raw game data (featureEngineering.js)
 * 3. Trains XGBoost models with promotion gating (train_xgboost.py)
 *
 * Usage:
 *   node backend/scripts/retrainFromTracking.js                  # Full retrain
 *   node backend/scripts/retrainFromTracking.js --incremental    # Incremental update
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '../..');
const RETRAIN_LOG = path.join(__dirname, '../data/retrain_log.json');

function loadRetrainLog() {
  try {
    if (fs.existsSync(RETRAIN_LOG)) {
      return JSON.parse(fs.readFileSync(RETRAIN_LOG, 'utf8'));
    }
  } catch (err) { /* ignore */ }
  return { lastRetrain: null, totalRetrains: 0, results: [] };
}

function saveRetrainLog(log) {
  const dir = path.dirname(RETRAIN_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RETRAIN_LOG, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Parse __RESULT_JSON__ from script output
 */
function parseResultJSON(output) {
  const marker = '__RESULT_JSON__:';
  const idx = output.lastIndexOf(marker);
  if (idx === -1) return null;
  const jsonStr = output.substring(idx + marker.length).trim();
  // Take the first line only (in case there's trailing output)
  const firstLine = jsonStr.split('\n')[0];
  try {
    return JSON.parse(firstLine);
  } catch (err) {
    console.error('Failed to parse result JSON:', err.message);
    return null;
  }
}

async function main() {
  const incremental = process.argv.includes('--incremental');
  const mode = incremental ? 'Incremental' : 'Full';

  console.log('='.repeat(60));
  console.log(`XGBoost Retraining Pipeline (${mode})`);
  console.log('='.repeat(60));

  const { execSync } = await import('child_process');
  const execOptions = {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 300000 // 5 minutes
  };

  // Step 1: Build per-prop training sets from evaluated predictions
  console.log('\n' + '='.repeat(60));
  console.log('Step 1: Building training sets from prediction feedback...');
  console.log('='.repeat(60));

  let buildResult = null;
  try {
    const buildOutput = execSync('python3 backend/ml/build_training_set.py', {
      ...execOptions,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(buildOutput);
    buildResult = parseResultJSON(buildOutput);
  } catch (err) {
    // build_training_set.py might fail if no predictions have feature vectors yet
    const output = err.stdout || '';
    console.log(output);
    buildResult = parseResultJSON(output);
    if (!buildResult) {
      console.log('Note: No prediction feedback data available yet (this is normal for first run)');
    }
  }

  const hasRetrainData = buildResult && buildResult.total_rows > 0;
  console.log(`\nRetrain data available: ${hasRetrainData ? `${buildResult.total_rows} rows` : 'none'}`);

  // Step 2: Refresh feature engineering (from raw game data)
  console.log('\n' + '='.repeat(60));
  console.log('Step 2: Refreshing feature engineering...');
  console.log('='.repeat(60));

  try {
    execSync('node backend/ml/featureEngineering.js', {
      ...execOptions,
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (err) {
    console.error('Feature engineering failed:', err.message);
    console.log('Continuing with existing training_features.csv...');
  }

  // Step 3: Train XGBoost models with promotion gating
  console.log('\n' + '='.repeat(60));
  console.log(`Step 3: Training XGBoost models (${mode})...`);
  console.log('='.repeat(60));

  const trainArgs = ['python3', 'backend/ml/train_xgboost.py'];
  if (incremental) trainArgs.push('--incremental');
  if (hasRetrainData) trainArgs.push('--retrain-data');

  let trainResult = null;
  try {
    const trainOutput = execSync(trainArgs.join(' '), {
      ...execOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 600000 // 10 minutes for training
    });
    console.log(trainOutput);
    trainResult = parseResultJSON(trainOutput);
  } catch (err) {
    const output = err.stdout || '';
    const stderr = err.stderr || '';
    console.log(output);
    if (stderr) console.error(stderr);
    trainResult = parseResultJSON(output);
    if (!trainResult) {
      console.error('XGBoost training failed:', err.message);
      return;
    }
  }

  // Step 4: Summary
  console.log('\n' + '='.repeat(60));
  console.log('Retraining Complete!');
  console.log('='.repeat(60));

  if (trainResult) {
    console.log(`\nModels promoted: ${trainResult.promoted}/${trainResult.total}`);
    console.log(`Models rejected: ${trainResult.rejected}/${trainResult.total}`);

    if (trainResult.results) {
      console.log('\nPer-prop results:');
      for (const r of trainResult.results) {
        const status = r.promoted ? 'PROMOTED' : 'REJECTED';
        const prev = r.current_test_mae ? r.current_test_mae.toFixed(3) : 'N/A';
        console.log(`  ${r.prop_type.padEnd(6)} Test MAE: ${r.test_mae.toFixed(3)} (prev: ${prev}) [${status}]`);
      }
    }
  }

  if (hasRetrainData) {
    console.log(`\nPrediction feedback data used: ${buildResult.total_rows} rows`);
  }

  // Save retrain log
  const log = loadRetrainLog();
  log.lastRetrain = new Date().toISOString();
  log.totalRetrains = (log.totalRetrains || 0) + 1;
  log.lastMode = mode.toLowerCase();
  log.lastResult = trainResult;
  log.retrainDataRows = hasRetrainData ? buildResult.total_rows : 0;
  // Keep last 10 results
  if (!log.history) log.history = [];
  log.history.unshift({
    date: log.lastRetrain,
    mode: log.lastMode,
    promoted: trainResult?.promoted || 0,
    rejected: trainResult?.rejected || 0,
    retrainRows: log.retrainDataRows
  });
  log.history = log.history.slice(0, 10);
  saveRetrainLog(log);

  console.log('\nRetrain log saved.');
  console.log('Restart the backend to use updated models.');
}

main().catch(err => {
  console.error('Retrain pipeline failed:', err);
  process.exit(1);
});
