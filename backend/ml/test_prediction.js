/**
 * Test script for ML prediction service
 * Usage: node backend/ml/test_prediction.js
 */

import { predictProp, predictAllProps, areModelsAvailable } from './mlPredictionService.js';

// Sample game logs (LeBron James-like stats)
const sampleGameLogs = [
  { pts: 25, reb: 7, ast: 8, tpm: 2, fg3m: 2, minutes: 35, fga: 20, fg3a: 6, date: '2024-12-01', game_date: '2024-12-01' },
  { pts: 28, reb: 6, ast: 7, tpm: 3, fg3m: 3, minutes: 36, fga: 22, fg3a: 8, date: '2024-12-03', game_date: '2024-12-03' },
  { pts: 23, reb: 8, ast: 9, tpm: 2, fg3m: 2, minutes: 34, fga: 18, fg3a: 5, date: '2024-12-05', game_date: '2024-12-05' },
  { pts: 30, reb: 5, ast: 6, tpm: 4, fg3m: 4, minutes: 38, fga: 24, fg3a: 10, date: '2024-12-07', game_date: '2024-12-07' },
  { pts: 27, reb: 7, ast: 7, tpm: 3, fg3m: 3, minutes: 36, fga: 21, fg3a: 7, date: '2024-12-09', game_date: '2024-12-09' },
  { pts: 26, reb: 6, ast: 8, tpm: 2, fg3m: 2, minutes: 35, fga: 19, fg3a: 6, date: '2024-12-11', game_date: '2024-12-11' },
  { pts: 29, reb: 7, ast: 7, tpm: 3, fg3m: 3, minutes: 37, fga: 23, fg3a: 8, date: '2024-12-13', game_date: '2024-12-13' },
  { pts: 24, reb: 8, ast: 9, tpm: 2, fg3m: 2, minutes: 34, fga: 18, fg3a: 5, date: '2024-12-15', game_date: '2024-12-15' },
  { pts: 31, reb: 6, ast: 6, tpm: 4, fg3m: 4, minutes: 38, fga: 25, fg3a: 10, date: '2024-12-17', game_date: '2024-12-17' },
  { pts: 28, reb: 7, ast: 8, tpm: 3, fg3m: 3, minutes: 36, fga: 22, fg3a: 8, date: '2024-12-19', game_date: '2024-12-19' },
  { pts: 25, reb: 6, ast: 7, tpm: 2, fg3m: 2, minutes: 35, fga: 20, fg3a: 6, date: '2024-12-21', game_date: '2024-12-21' },
  { pts: 27, reb: 8, ast: 9, tpm: 3, fg3m: 3, minutes: 37, fga: 21, fg3a: 7, date: '2024-12-23', game_date: '2024-12-23' },
  { pts: 30, reb: 7, ast: 6, tpm: 4, fg3m: 4, minutes: 38, fga: 24, fg3a: 9, date: '2024-12-25', game_date: '2024-12-25' },
  { pts: 26, reb: 6, ast: 8, tpm: 2, fg3m: 2, minutes: 35, fga: 19, fg3a: 6, date: '2024-12-27', game_date: '2024-12-27' },
  { pts: 29, reb: 7, ast: 7, tpm: 3, fg3m: 3, minutes: 37, fga: 23, fg3a: 8, date: '2024-12-29', game_date: '2024-12-29' }
];

async function testSinglePropPrediction() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         Testing Single Prop Prediction                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    const prediction = await predictProp(sampleGameLogs, 'PTS');
    console.log('✅ Points Prediction:', prediction.toFixed(2));

    const rebPrediction = await predictProp(sampleGameLogs, 'REB');
    console.log('✅ Rebounds Prediction:', rebPrediction.toFixed(2));

    const astPrediction = await predictProp(sampleGameLogs, 'AST');
    console.log('✅ Assists Prediction:', astPrediction.toFixed(2));

    const threePrediction = await predictProp(sampleGameLogs, '3PM');
    console.log('✅ Threes Prediction:', threePrediction.toFixed(2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testAllPropsPrediction() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         Testing All Props Prediction                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    const predictions = await predictAllProps(sampleGameLogs);

    console.log('Predictions:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const [propType, value] of Object.entries(predictions)) {
      if (value !== null) {
        console.log(`  ${propType.padEnd(6)} : ${value.toFixed(2)}`);
      } else {
        console.log(`  ${propType.padEnd(6)} : FAILED`);
      }
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         ML Prediction Service - Test Suite                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Check if models are available
  const modelsAvailable = areModelsAvailable();
  console.log('🔍 Models Available:', modelsAvailable ? '✅ YES' : '❌ NO');

  if (!modelsAvailable) {
    console.log('\n⚠️  ML models not found!');
    console.log('\nPlease train models first:');
    console.log('  1. node backend/ml/dataCollector.js');
    console.log('  2. node backend/ml/featureEngineering.js');
    console.log('  3. python3 backend/ml/train.py');
    console.log('\nOr run the full pipeline:');
    console.log('  bash backend/ml/train_pipeline.sh\n');
    process.exit(1);
  }

  console.log('\n📊 Sample Game Logs:');
  console.log(`  Games: ${sampleGameLogs.length}`);

  const avgPts = sampleGameLogs.reduce((sum, g) => sum + g.pts, 0) / sampleGameLogs.length;
  const avgReb = sampleGameLogs.reduce((sum, g) => sum + g.reb, 0) / sampleGameLogs.length;
  const avgAst = sampleGameLogs.reduce((sum, g) => sum + g.ast, 0) / sampleGameLogs.length;

  console.log(`  Avg Points: ${avgPts.toFixed(1)}`);
  console.log(`  Avg Rebounds: ${avgReb.toFixed(1)}`);
  console.log(`  Avg Assists: ${avgAst.toFixed(1)}`);

  // Run tests
  await testSinglePropPrediction();
  await testAllPropsPrediction();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         All Tests Complete! ✅                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
