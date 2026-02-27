/**
 * Test All Endpoints - Verify all prop types work correctly
 * Usage: node backend/ml/test_all_endpoints.js [player_name]
 */

import axios from 'axios';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const DEFAULT_PLAYER = 'LeBron James';

// All supported prop types
const PROP_TYPES = [
  { name: 'points', label: 'Points' },
  { name: 'rebounds', label: 'Rebounds' },
  { name: 'assists', label: 'Assists' },
  { name: 'threes', label: 'Three-Pointers' },
  { name: 'pra', label: 'Points+Rebounds+Assists' },
  { name: 'pr', label: 'Points+Rebounds' },
  { name: 'pa', label: 'Points+Assists' },
  { name: 'ra', label: 'Rebounds+Assists' }
];

/**
 * Test a single prop type endpoint
 */
async function testPropType(playerName, propType) {
  const url = `${BACKEND_URL}/api/player/1/prediction/${propType.name}?name=${encodeURIComponent(playerName)}`;

  try {
    const startTime = Date.now();
    const response = await axios.get(url, { timeout: 30000 });
    const duration = Date.now() - startTime;

    if (response.data && response.data.predicted_value !== null) {
      return {
        success: true,
        propType: propType.name,
        label: propType.label,
        prediction: response.data.predicted_value,
        confidence: response.data.confidence,
        recommendation: response.data.recommendation,
        errorMargin: response.data.error_margin,
        duration,
        method: response.data.method || 'unknown'
      };
    } else {
      return {
        success: false,
        propType: propType.name,
        label: propType.label,
        error: response.data.error || 'No predicted value returned',
        duration
      };
    }
  } catch (error) {
    return {
      success: false,
      propType: propType.name,
      label: propType.label,
      error: error.response?.data?.error || error.message,
      duration: null
    };
  }
}

/**
 * Test all prop types
 */
async function testAllPropTypes(playerName) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         Testing All Prop Type Endpoints                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Player: ${playerName}\n`);
  console.log('━'.repeat(80));

  const results = [];

  for (const propType of PROP_TYPES) {
    process.stdout.write(`Testing ${propType.label.padEnd(30)}... `);

    const result = await testPropType(playerName, propType);
    results.push(result);

    if (result.success) {
      console.log(`✅ ${result.prediction.toFixed(2)} (${result.confidence}, ${result.duration}ms)`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

/**
 * Print summary
 */
function printSummary(results) {
  console.log('\n' + '━'.repeat(80));
  console.log('\n📊 SUMMARY\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${successful.length} ✅`);
  console.log(`Failed: ${failed.length} ${failed.length > 0 ? '❌' : ''}`);

  if (successful.length > 0) {
    const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    console.log(`Average Response Time: ${avgDuration.toFixed(0)}ms`);

    // Check which method was used
    const mlCount = successful.filter(r => r.method === 'xgboost_model' || r.method === 'custom_ml_model').length;
    const fallbackCount = successful.filter(r => r.method === 'statistical_fallback').length;

    console.log(`\nPrediction Methods:`);
    console.log(`  XGBoost/ML Models: ${mlCount}`);
    console.log(`  Statistical Fallback: ${fallbackCount}`);

    if (mlCount === 0 && fallbackCount > 0) {
      console.log(`\n⚠️  WARNING: ML models are not being used!`);
      console.log(`   Train your models first:`);
      console.log(`   bash backend/ml/train_pipeline.sh\n`);
    } else if (mlCount > 0) {
      console.log(`\n✅ XGBoost models are working!\n`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Tests:');
    failed.forEach(r => {
      console.log(`  - ${r.label}: ${r.error}`);
    });
    console.log('');
  }

  // Print detailed results table
  if (successful.length > 0) {
    console.log('\n' + '━'.repeat(80));
    console.log('\n📋 DETAILED RESULTS\n');

    console.log('Prop Type                 | Prediction | Confidence | Recommendation | Time');
    console.log('━'.repeat(80));

    successful.forEach(r => {
      const propLabel = r.label.padEnd(24);
      const prediction = r.prediction.toFixed(2).padStart(10);
      const confidence = r.confidence.padEnd(10);
      const recommendation = (r.recommendation || 'N/A').padEnd(14);
      const time = `${r.duration}ms`;

      console.log(`${propLabel} | ${prediction} | ${confidence} | ${recommendation} | ${time}`);
    });

    console.log('━'.repeat(80));
  }

  console.log('');
}

/**
 * Main execution
 */
async function main() {
  const playerName = process.argv[2] || DEFAULT_PLAYER;

  try {
    // Test if backend is running
    console.log('\n🔍 Checking backend connection...');
    try {
      await axios.get(`${BACKEND_URL}/api/player/with-lines`, { timeout: 5000 });
      console.log('✅ Backend is running\n');
    } catch (error) {
      console.error('❌ Cannot connect to backend!');
      console.error(`   Make sure backend is running at: ${BACKEND_URL}`);
      console.error(`   Error: ${error.message}\n`);
      process.exit(1);
    }

    // Test all prop types
    const results = await testAllPropTypes(playerName);

    // Print summary
    printSummary(results);

    // Exit with appropriate code
    const allPassed = results.every(r => r.success);
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { testAllPropTypes, testPropType };
