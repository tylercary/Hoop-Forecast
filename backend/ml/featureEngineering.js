/**
 * Feature Engineering Pipeline
 * Calculates all features needed for ML training
 * Usage: node backend/ml/featureEngineering.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'combined_training_data.csv');
const OUTPUT_FILE = path.join(DATA_DIR, 'training_features.csv');

/**
 * Calculate rolling average for an array of values
 */
function rollingAverage(values, window) {
  if (values.length < window) {
    return values.reduce((sum, val) => sum + val, 0) / values.length || 0;
  }
  const recentValues = values.slice(-window);
  return recentValues.reduce((sum, val) => sum + val, 0) / window;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values) {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate volatility (coefficient of variation)
 */
function calculateVolatility(values) {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  if (avg === 0) return 0;
  const std = standardDeviation(values);
  return (std / avg) * 100;
}

/**
 * Calculate usage rate estimate
 */
function calculateUsage(avgPoints, avgMinutes) {
  if (!avgMinutes || avgMinutes === 0) return 0;
  const usage = (avgPoints / avgMinutes) * 2.5;
  return Math.min(Math.max(usage, 0), 100);
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parse CSV file into array of objects
 */
async function parseCSV(filePath) {
  console.log(`Loading data from: ${filePath}`);

  const csvContent = await fs.readFile(filePath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  const headers = parseCSVLine(lines[0]);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  console.log(`✓ Loaded ${data.length} games`);
  return data;
}

/**
 * Group games by player and sort by date
 */
function groupGamesByPlayer(games) {
  console.log('\nGrouping games by player...');

  const playerGames = {};

  for (const game of games) {
    const playerKey = game.player_id || game.player_name;
    if (!playerKey) continue;

    if (!playerGames[playerKey]) {
      playerGames[playerKey] = {
        name: game.player_name,
        id: game.player_id,
        games: []
      };
    }

    playerGames[playerKey].games.push(game);
  }

  // Sort each player's games by date (oldest first)
  for (const playerKey in playerGames) {
    playerGames[playerKey].games.sort((a, b) => {
      const dateA = new Date(a.game_date);
      const dateB = new Date(b.game_date);
      return dateA - dateB;
    });
  }

  console.log(`✓ Grouped into ${Object.keys(playerGames).length} players`);
  return playerGames;
}

/**
 * Calculate features for all prop types
 */
function calculateFeatures(playerGames) {
  console.log('\nCalculating features...');

  const featuredData = [];
  let totalGames = 0;

  for (const playerKey in playerGames) {
    const player = playerGames[playerKey];
    const games = player.games;

    // Need at least 10 games to calculate meaningful features
    // (matches requirement in mlPredictionService.js)
    if (games.length < 10) continue;

    // Start from game 10 onwards (need 10 previous games for rolling averages)
    for (let i = 10; i < games.length; i++) {
      const currentGame = games[i];
      const previousGames = games.slice(0, i);

      // Extract numeric values from previous games
      const prevPts = previousGames.map(g => parseFloat(g.pts) || 0);
      const prevReb = previousGames.map(g => parseFloat(g.reb) || 0);
      const prevAst = previousGames.map(g => parseFloat(g.ast) || 0);
      const prev3pm = previousGames.map(g => parseFloat(g.fg3m) || 0);
      const prevMin = previousGames.map(g => parseFloat(g.minutes) || 0);
      const prevFga = previousGames.map(g => parseFloat(g.fga) || 0);
      const prevFg3a = previousGames.map(g => parseFloat(g.fg3a) || 0);

      // Skip if player didn't play in current game (DNP)
      const currentMinutes = parseFloat(currentGame.minutes) || 0;
      if (currentMinutes === 0) continue;

      // === POINTS FEATURES ===
      const pts_avg_3 = rollingAverage(prevPts, 3);
      const pts_avg_5 = rollingAverage(prevPts, 5);
      const pts_avg_10 = rollingAverage(prevPts, 10);
      const pts_avg_season = prevPts.reduce((sum, val) => sum + val, 0) / prevPts.length;
      const pts_std_10 = standardDeviation(prevPts.slice(-10));
      const pts_volatility = calculateVolatility(prevPts.slice(-10));

      // === REBOUNDS FEATURES ===
      const reb_avg_3 = rollingAverage(prevReb, 3);
      const reb_avg_5 = rollingAverage(prevReb, 5);
      const reb_avg_10 = rollingAverage(prevReb, 10);
      const reb_avg_season = prevReb.reduce((sum, val) => sum + val, 0) / prevReb.length;
      const reb_std_10 = standardDeviation(prevReb.slice(-10));
      const reb_volatility = calculateVolatility(prevReb.slice(-10));

      // === ASSISTS FEATURES ===
      const ast_avg_3 = rollingAverage(prevAst, 3);
      const ast_avg_5 = rollingAverage(prevAst, 5);
      const ast_avg_10 = rollingAverage(prevAst, 10);
      const ast_avg_season = prevAst.reduce((sum, val) => sum + val, 0) / prevAst.length;
      const ast_std_10 = standardDeviation(prevAst.slice(-10));
      const ast_volatility = calculateVolatility(prevAst.slice(-10));

      // === THREE-POINTERS FEATURES ===
      const threes_avg_3 = rollingAverage(prev3pm, 3);
      const threes_avg_5 = rollingAverage(prev3pm, 5);
      const threes_avg_10 = rollingAverage(prev3pm, 10);
      const threes_avg_season = prev3pm.reduce((sum, val) => sum + val, 0) / prev3pm.length;
      const threes_std_10 = standardDeviation(prev3pm.slice(-10));
      const threes_volatility = calculateVolatility(prev3pm.slice(-10));

      // === MINUTES & USAGE ===
      const min_avg_3 = rollingAverage(prevMin, 3);
      const min_avg_5 = rollingAverage(prevMin, 5);
      const min_avg_10 = rollingAverage(prevMin, 10);
      const usage = calculateUsage(pts_avg_10, min_avg_10);

      // === SHOOTING EFFICIENCY ===
      const fga_avg_10 = rollingAverage(prevFga, 10);
      const fg3a_avg_10 = rollingAverage(prevFg3a, 10);

      // === COMBINED PROPS ===
      const pra_avg_3 = pts_avg_3 + reb_avg_3 + ast_avg_3;
      const pra_avg_5 = pts_avg_5 + reb_avg_5 + ast_avg_5;
      const pra_avg_10 = pts_avg_10 + reb_avg_10 + ast_avg_10;

      const pr_avg_3 = pts_avg_3 + reb_avg_3;
      const pr_avg_5 = pts_avg_5 + reb_avg_5;
      const pr_avg_10 = pts_avg_10 + reb_avg_10;

      const pa_avg_3 = pts_avg_3 + ast_avg_3;
      const pa_avg_5 = pts_avg_5 + ast_avg_5;
      const pa_avg_10 = pts_avg_10 + ast_avg_10;

      const ra_avg_3 = reb_avg_3 + ast_avg_3;
      const ra_avg_5 = reb_avg_5 + ast_avg_5;
      const ra_avg_10 = reb_avg_10 + ast_avg_10;

      // === HOME/AWAY ===
      const is_home = currentGame.matchup && currentGame.matchup.includes('vs.') ? 1 : 0;

      // === HOT STREAK INDICATORS ===
      // Compare recent 3 games vs season average (positive = hot, negative = cold)
      const pts_hot_streak = pts_avg_3 - pts_avg_season;
      const reb_hot_streak = reb_avg_3 - reb_avg_season;
      const ast_hot_streak = ast_avg_3 - ast_avg_season;
      const threes_hot_streak = threes_avg_3 - threes_avg_season;

      // Performance momentum (last 3 games trend)
      const pts_momentum = prevPts.length >= 3 ?
        (prevPts.slice(-1)[0] - prevPts.slice(-3, -2)[0]) / 3 : 0;
      const reb_momentum = prevReb.length >= 3 ?
        (prevReb.slice(-1)[0] - prevReb.slice(-3, -2)[0]) / 3 : 0;
      const ast_momentum = prevAst.length >= 3 ?
        (prevAst.slice(-1)[0] - prevAst.slice(-3, -2)[0]) / 3 : 0;

      // Consecutive games over season average (streak)
      let pts_over_streak = 0;
      for (let j = prevPts.length - 1; j >= Math.max(0, prevPts.length - 5); j--) {
        if (prevPts[j] > pts_avg_season) pts_over_streak++;
        else break;
      }

      // === DAYS REST & SCHEDULE ===
      let days_rest = 1; // Default 1 day
      let is_back_to_back = 0;
      let games_in_last_week = 0;

      if (i > 0) {
        const currentDate = new Date(currentGame.game_date);
        const prevDate = new Date(previousGames[i-1].game_date);
        const daysDiff = Math.round((currentDate - prevDate) / (1000 * 60 * 60 * 24));
        days_rest = Math.max(0, Math.min(daysDiff, 7)); // Cap at 7 days
        is_back_to_back = daysDiff === 1 ? 1 : 0;

        // Count games in last 7 days
        const weekAgo = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        games_in_last_week = previousGames.filter(g => {
          const gDate = new Date(g.game_date);
          return gDate >= weekAgo && gDate < currentDate;
        }).length;
      }

      // === WIN/LOSS STREAK ===
      let win_streak = 0;
      let loss_streak = 0;
      for (let j = previousGames.length - 1; j >= Math.max(0, previousGames.length - 10); j--) {
        const result = previousGames[j].wl;
        if (result === 'W') {
          if (loss_streak === 0) win_streak++;
          else break;
        } else if (result === 'L') {
          if (win_streak === 0) loss_streak++;
          else break;
        }
      }

      // Recent win percentage (last 10 games)
      const recent_wins = previousGames.slice(-10).filter(g => g.wl === 'W').length;
      const recent_win_pct = recent_wins / Math.min(10, previousGames.length);

      // === EFFICIENCY & SHOOTING TRENDS ===
      const prevFgPct = previousGames.slice(-10).map(g => parseFloat(g.fg_pct) || 0);
      const prevFtPct = previousGames.slice(-10).map(g => parseFloat(g.ft_pct) || 0);
      const prevFta = previousGames.slice(-10).map(g => parseFloat(g.fta) || 0);
      const fg_pct_avg_10 = prevFgPct.reduce((s, v) => s + v, 0) / prevFgPct.length;
      const ft_rate_avg_10 = prevFta.reduce((s, v) => s + v, 0) / prevFta.length;

      // FG% trend: recent 3 vs recent 10 (positive = shooting better recently)
      const fg_pct_recent3 = previousGames.slice(-3).map(g => parseFloat(g.fg_pct) || 0);
      const fg_pct_trend = (fg_pct_recent3.reduce((s, v) => s + v, 0) / fg_pct_recent3.length) - fg_pct_avg_10;

      // === MINUTES DEVIATION (key predictor of blowout/rest games) ===
      const min_std_10 = standardDeviation(prevMin.slice(-10));
      const min_trend = rollingAverage(prevMin, 3) - rollingAverage(prevMin, 10);

      // === PLUS/MINUS CONTEXT (team competitiveness) ===
      const prevPlusMinus = previousGames.slice(-10).map(g => parseFloat(g.plus_minus) || 0);
      const plus_minus_avg_10 = prevPlusMinus.reduce((s, v) => s + v, 0) / prevPlusMinus.length;

      // === CROSS-STAT INTERACTIONS ===
      // Points per minute (efficiency beyond just volume)
      const pts_per_min_10 = rollingAverage(prevMin, 10) > 0 ?
        rollingAverage(prevPts, 10) / rollingAverage(prevMin, 10) : 0;
      // FGA share trend (is this player taking more/fewer shots recently?)
      const fga_trend = rollingAverage(prevFga.slice(-3), 3) - rollingAverage(prevFga.slice(-10), 10);
      // Rebound rate per minute
      const reb_per_min_10 = rollingAverage(prevMin, 10) > 0 ?
        rollingAverage(prevReb, 10) / rollingAverage(prevMin, 10) : 0;

      // === CONSISTENCY FEATURES ===
      // How often does this player hit their average? (hit rate within 20%)
      const pts_hit_rate = (() => {
        const last10 = prevPts.slice(-10);
        if (last10.length === 0 || pts_avg_season === 0) return 0.5;
        const threshold = pts_avg_season * 0.2;
        return last10.filter(v => Math.abs(v - pts_avg_season) <= threshold).length / last10.length;
      })();
      const reb_hit_rate = (() => {
        const last10 = prevReb.slice(-10);
        if (last10.length === 0 || reb_avg_season === 0) return 0.5;
        const threshold = Math.max(reb_avg_season * 0.25, 1.5);
        return last10.filter(v => Math.abs(v - reb_avg_season) <= threshold).length / last10.length;
      })();

      // === TARGET VARIABLES (what we're predicting) ===
      const target_pts = parseFloat(currentGame.pts) || 0;
      const target_reb = parseFloat(currentGame.reb) || 0;
      const target_ast = parseFloat(currentGame.ast) || 0;
      const target_3pm = parseFloat(currentGame.fg3m) || 0;
      const target_pra = target_pts + target_reb + target_ast;
      const target_pr = target_pts + target_reb;
      const target_pa = target_pts + target_ast;
      const target_ra = target_reb + target_ast;

      // Build feature row
      const featureRow = {
        // Identifiers
        player_id: player.id,
        player_name: player.name,
        game_id: currentGame.game_id,
        game_date: currentGame.game_date,

        // Points features
        pts_avg_3,
        pts_avg_5,
        pts_avg_10,
        pts_avg_season,
        pts_std_10,
        pts_volatility,

        // Rebounds features
        reb_avg_3,
        reb_avg_5,
        reb_avg_10,
        reb_avg_season,
        reb_std_10,
        reb_volatility,

        // Assists features
        ast_avg_3,
        ast_avg_5,
        ast_avg_10,
        ast_avg_season,
        ast_std_10,
        ast_volatility,

        // Three-pointers features
        threes_avg_3,
        threes_avg_5,
        threes_avg_10,
        threes_avg_season,
        threes_std_10,
        threes_volatility,

        // Minutes & usage
        min_avg_3,
        min_avg_5,
        min_avg_10,
        usage,

        // Shooting
        fga_avg_10,
        fg3a_avg_10,

        // Combined props rolling averages
        pra_avg_3,
        pra_avg_5,
        pra_avg_10,
        pr_avg_3,
        pr_avg_5,
        pr_avg_10,
        pa_avg_3,
        pa_avg_5,
        pa_avg_10,
        ra_avg_3,
        ra_avg_5,
        ra_avg_10,

        // Context
        is_home,

        // Hot streak indicators
        pts_hot_streak,
        reb_hot_streak,
        ast_hot_streak,
        threes_hot_streak,
        pts_momentum,
        reb_momentum,
        ast_momentum,
        pts_over_streak,

        // Rest & schedule
        days_rest,
        is_back_to_back,
        games_in_last_week,

        // Win/loss trends
        win_streak,
        loss_streak,
        recent_win_pct,

        // Efficiency & shooting
        fg_pct_avg_10,
        fg_pct_trend,
        ft_rate_avg_10,

        // Minutes deviation
        min_std_10,
        min_trend,

        // Team context
        plus_minus_avg_10,

        // Cross-stat interactions
        pts_per_min_10,
        fga_trend,
        reb_per_min_10,

        // Consistency
        pts_hit_rate,
        reb_hit_rate,

        // Targets
        target_pts,
        target_reb,
        target_ast,
        target_3pm,
        target_pra,
        target_pr,
        target_pa,
        target_ra
      };

      featuredData.push(featureRow);
      totalGames++;
    }
  }

  console.log(`✓ Calculated features for ${totalGames} games`);
  return featuredData;
}

/**
 * Save features to CSV
 */
async function saveFeaturesToCSV(data, outputPath) {
  console.log('\nSaving features to CSV...');

  if (data.length === 0) {
    throw new Error('No featured data to save!');
  }

  const headers = Object.keys(data[0]);
  let csvContent = headers.join(',') + '\n';

  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      if (value === undefined || value === null) return '';
      return value;
    });
    csvContent += values.join(',') + '\n';
  }

  await fs.writeFile(outputPath, csvContent, 'utf8');
  console.log(`✓ Saved ${data.length} feature rows to: ${outputPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Feature Engineering Pipeline         ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Step 1: Load raw game data
    const rawGames = await parseCSV(INPUT_FILE);

    // Step 2: Group by player and sort by date
    const playerGames = groupGamesByPlayer(rawGames);

    // Step 3: Calculate features for each game
    const featuredData = calculateFeatures(playerGames);

    if (featuredData.length === 0) {
      console.error('\n✗ No feature data generated. Check your input data.');
      process.exit(1);
    }

    // Step 4: Save to CSV
    await saveFeaturesToCSV(featuredData, OUTPUT_FILE);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   Feature Engineering Complete! ✓      ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log(`Output file: ${OUTPUT_FILE}`);
    console.log(`Total feature rows: ${featuredData.length}`);
    console.log(`Features calculated: 54 features for 8 prop types`);
    console.log(`\nNext step: Train ML models`);
    console.log(`  → python3 backend/ml/train.py\n`);

  } catch (error) {
    console.error('\n✗ Error during feature engineering:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { calculateFeatures, groupGamesByPlayer };
