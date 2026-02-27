/**
 * Backtest Model Script
 * Tests model predictions against recent completed games to validate accuracy
 *
 * Usage: node scripts/backtestModel.js "Player Name" [numGames]
 * Example: node scripts/backtestModel.js "LeBron James" 10
 */

import axios from 'axios';
import { trackPrediction, updatePredictionResult, calculatePerformance } from '../services/performanceTrackingService.js';

const API_BASE = 'http://localhost:5001/api';

// Prop types to test
const PROP_TYPES = ['points', 'assists', 'rebounds', 'threes', 'steals', 'blocks'];

async function backtestPlayer(playerName, numGames = 10) {
  console.log(`\n🏀 Backtesting model for: ${playerName}`);
  console.log(`📊 Testing against last ${numGames} completed games\n`);

  try {
    // Step 1: Search for player
    console.log('1️⃣  Searching for player...');
    const searchResponse = await axios.get(`${API_BASE}/search`, {
      params: { q: playerName }
    });

    // The search API returns an array directly, not { results: [...] }
    const results = Array.isArray(searchResponse.data) ? searchResponse.data : searchResponse.data.results || [];

    if (results.length === 0) {
      console.error('❌ Player not found');
      return;
    }

    const player = results[0];
    console.log(`   ✅ Found: ${player.first_name} ${player.last_name} (${player.team?.abbreviation || 'N/A'})\n`);

    // Step 2: Fetch player's game log and comparison data
    console.log('2️⃣  Fetching game history...');
    const comparisonResponse = await axios.get(`${API_BASE}/player/${player.id}/compare`, {
      params: { name: `${player.first_name} ${player.last_name}` }
    });

    const stats = comparisonResponse.data.stats || [];
    if (stats.length === 0) {
      console.error('❌ No game history found');
      return;
    }

    // Sort by date (most recent first) and take numGames
    // Filter: only completed games where player actually played (DNP = Did Not Play)
    const recentGames = stats
      .filter(game => {
        // Must have played (not DNP)
        if (game.minutes == null || game.minutes === 0 || game.minutes === '0:00') {
          return false; // Player didn't play (DNP, injury, etc.)
        }
        // Must have at least some stat data
        if (game.points == null) {
          return false; // No data available
        }
        return true; // Valid game
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, numGames);

    console.log(`   ✅ Found ${recentGames.length} recent completed games\n`);

    // Step 3: For each game, make predictions and compare
    console.log('3️⃣  Making predictions and comparing to actual results...\n');

    let totalPredictions = 0;
    let totalHits = 0;
    const propResults = {};

    for (let i = 0; i < recentGames.length; i++) {
      const game = recentGames[i];
      const gameDate = new Date(game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      console.log(`   📅 Game ${i + 1}: ${game.opponent || 'vs Unknown'} on ${gameDate}`);

      for (const propType of PROP_TYPES) {
        // Get actual value from game
        const actualValue = getActualValue(game, propType);

        if (actualValue == null || actualValue < 0) {
          console.log(`      ⏭️  ${propType}: No data available`);
          continue;
        }

        try {
          // Small delay to avoid overwhelming APIs (especially NBA.com)
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between predictions

          // Make prediction for this prop type (with 15 second timeout)
          const predictionResponse = await axios.get(`${API_BASE}/player/${player.id}/prediction/${propType}`, {
            params: { name: `${player.first_name} ${player.last_name}` },
            timeout: 15000 // 15 second timeout for backtesting
          });

          const predictedValue = predictionResponse.data[`predicted_${propType}`] || predictionResponse.data.predicted_value;

          if (predictedValue == null || isNaN(predictedValue)) {
            console.log(`      ⏭️  ${propType}: Prediction failed`);
            continue;
          }

          // Get betting line from props (if available)
          const bettingLine = comparisonResponse.data.props?.[propType]?.line || predictedValue;

          // Determine if prediction hit or missed
          const recommendation = predictedValue > bettingLine ? 'OVER' : predictedValue < bettingLine ? 'UNDER' : 'PUSH';
          const isHit = (recommendation === 'OVER' && actualValue >= bettingLine) ||
                        (recommendation === 'UNDER' && actualValue < bettingLine);
          const result = recommendation === 'PUSH' ? 'push' : (isHit ? 'hit' : 'miss');

          // Track prediction
          const predictionData = {
            playerName: `${player.first_name} ${player.last_name}`,
            playerId: player.id.toString(),
            propType: propType,
            prediction: predictedValue,
            bettingLine: bettingLine,
            coverProbability: predictionResponse.data.confidence || 50,
            gameDate: game.date,
            opponent: game.opponent,
            team: player.team?.abbreviation || 'N/A',
            actual: actualValue,
            result: result
          };

          const trackedPrediction = trackPrediction(predictionData);
          updatePredictionResult(trackedPrediction.id, actualValue);

          // Track stats
          totalPredictions++;
          if (result === 'hit') totalHits++;

          if (!propResults[propType]) {
            propResults[propType] = { total: 0, hits: 0 };
          }
          propResults[propType].total++;
          if (result === 'hit') propResults[propType].hits++;

          // Log result
          const emoji = result === 'hit' ? '✅' : result === 'miss' ? '❌' : '➖';
          console.log(`      ${emoji} ${propType}: Predicted ${predictedValue.toFixed(1)} (${recommendation}) | Actual ${actualValue} | Line ${bettingLine.toFixed(1)}`);

        } catch (err) {
          const errorMsg = err.code === 'ECONNABORTED' ? 'Request timeout (>10s)' : err.message;
          console.log(`      ⚠️  ${propType}: ${errorMsg}`);
        }
      }

      console.log(''); // Empty line between games

      // Delay between games to avoid rate limiting
      if (i < recentGames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between games
      }
    }

    // Step 4: Show summary statistics
    console.log('\n📈 BACKTEST RESULTS\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Player: ${player.first_name} ${player.last_name}`);
    console.log(`Games Tested: ${recentGames.length}`);
    console.log(`Total Predictions: ${totalPredictions}`);
    console.log(`Hits: ${totalHits}`);
    console.log(`Misses: ${totalPredictions - totalHits}`);
    console.log(`Overall Hit Rate: ${totalPredictions > 0 ? ((totalHits / totalPredictions) * 100).toFixed(1) : 0}%`);
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📊 BREAKDOWN BY PROP TYPE\n');
    Object.keys(propResults).forEach(propType => {
      const { total, hits } = propResults[propType];
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) : 0;
      const emoji = hitRate >= 60 ? '🟢' : hitRate >= 50 ? '🟡' : '🔴';
      console.log(`${emoji} ${propType.padEnd(15)}: ${hitRate}% (${hits}/${total})`);
    });

    console.log('\n✅ Backtest complete! Predictions have been tracked in the performance system.');
    console.log('   You can view them at: http://localhost:3000 (Model Performance section)\n');

    // Show current overall performance
    const performance = calculatePerformance();
    if (performance.overall.total > 0) {
      console.log('📊 OVERALL MODEL PERFORMANCE (All Time)\n');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`Total Predictions: ${performance.overall.total}`);
      console.log(`Hit Rate: ${performance.overall.hitRate}%`);
      console.log(`Hits: ${performance.overall.hits}`);
      console.log(`Misses: ${performance.overall.misses}`);
      console.log(`Pending: ${performance.overall.pending}`);
      console.log('═══════════════════════════════════════════════════════\n');
    }

  } catch (error) {
    console.error('\n❌ Error during backtest:', error.message);
    if (error.response) {
      console.error('   API Error:', error.response.data);
    }
  }
}

// Helper function to get actual stat value from game
function getActualValue(game, propType) {
  switch (propType) {
    case 'points':
      return game.points;
    case 'assists':
      return game.assists;
    case 'rebounds':
      return game.rebounds;
    case 'steals':
      return game.steals;
    case 'blocks':
      return game.blocks;
    case 'threes':
      return game.threes_made || game.threes;
    default:
      return null;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('\n📖 Usage: node scripts/backtestModel.js "Player Name" [numGames]');
  console.log('\nExamples:');
  console.log('  node scripts/backtestModel.js "LeBron James" 10');
  console.log('  node scripts/backtestModel.js "Stephen Curry" 15');
  console.log('  node scripts/backtestModel.js "Luka Doncic"\n');
  console.log('Or via npm:');
  console.log('  npm run backtest -- "LeBron James" 10\n');
  process.exit(1);
}

// Join all non-numeric arguments as the player name
let playerName = '';
let numGames = 10;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const isNumber = !isNaN(parseInt(arg)) && parseInt(arg) > 0;

  if (isNumber) {
    numGames = parseInt(arg);
    break;
  } else {
    playerName += (playerName ? ' ' : '') + arg;
  }
}

if (!playerName) {
  console.error('❌ Player name is required');
  process.exit(1);
}

// Run backtest
backtestPlayer(playerName, numGames);
