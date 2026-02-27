/**
 * Data Collector - Fetches recent NBA games and combines with existing data
 * Usage: node backend/ml/dataCollector.js
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'combined_training_data.csv');
const EXISTING_DATA_FILE = path.join(DATA_DIR, 'final_training_dataset_clean.csv');

// NBA.com API configuration
const NBA_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com'
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all players for current season
 */
async function fetchAllPlayers() {
  console.log('Fetching all active NBA players...');
  const url = 'https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2025-26&IsOnlyCurrentSeason=1';

  try {
    const response = await fetch(url, { headers: NBA_API_HEADERS });
    if (!response.ok) throw new Error(`Failed to fetch players: ${response.status}`);

    const data = await response.json();
    const headers = data.resultSets[0].headers;
    const rows = data.resultSets[0].rowSet;

    const players = rows.map(row => {
      const player = {};
      headers.forEach((header, index) => {
        player[header] = row[index];
      });
      return {
        id: player.PERSON_ID,
        name: player.DISPLAY_FIRST_LAST,
        isActive: player.ROSTERSTATUS === 1
      };
    }).filter(p => p.isActive);

    console.log(`Found ${players.length} active players`);
    return players;
  } catch (error) {
    console.error('Error fetching players:', error.message);
    return [];
  }
}

/**
 * Fetch game logs for a specific player
 */
async function fetchPlayerGameLogs(playerId, playerName, season = '2024-25') {
  const url = `https://stats.nba.com/stats/playergamelog?PlayerID=${playerId}&Season=${season}&SeasonType=Regular+Season`;

  try {
    const response = await fetch(url, { headers: NBA_API_HEADERS });
    if (!response.ok) return [];

    const data = await response.json();
    if (!data.resultSets || !data.resultSets[0]) return [];

    const headers = data.resultSets[0].headers;
    const rows = data.resultSets[0].rowSet;

    const games = rows.map(row => {
      const game = {};
      headers.forEach((header, index) => {
        game[header] = row[index];
      });

      // Extract key stats - matching your existing data format
      return {
        player_name: playerName,
        player_id: playerId,
        game_id: game.Game_ID,
        game_date: game.GAME_DATE,
        matchup: game.MATCHUP,
        wl: game.WL,
        minutes: parseFloat(game.MIN) || 0,
        pts: parseInt(game.PTS) || 0,
        reb: parseInt(game.REB) || 0,
        ast: parseInt(game.AST) || 0,
        stl: parseInt(game.STL) || 0,
        blk: parseInt(game.BLK) || 0,
        tov: parseInt(game.TOV) || 0,
        fgm: parseInt(game.FGM) || 0,
        fga: parseInt(game.FGA) || 0,
        fg_pct: parseFloat(game.FG_PCT) || 0,
        fg3m: parseInt(game.FG3M) || 0,
        fg3a: parseInt(game.FG3A) || 0,
        fg3_pct: parseFloat(game.FG3_PCT) || 0,
        ftm: parseInt(game.FTM) || 0,
        fta: parseInt(game.FTA) || 0,
        ft_pct: parseFloat(game.FT_PCT) || 0,
        oreb: parseInt(game.OREB) || 0,
        dreb: parseInt(game.DREB) || 0,
        pf: parseInt(game.PF) || 0,
        plus_minus: parseInt(game.PLUS_MINUS) || 0,
        season: season
      };
    });

    return games;
  } catch (error) {
    console.error(`Error fetching game logs for ${playerName}:`, error.message);
    return [];
  }
}

/**
 * Fetch recent game data for all players
 */
async function fetchRecentGameData() {
  console.log('\n=== Fetching Recent NBA Game Data ===\n');

  const players = await fetchAllPlayers();
  if (players.length === 0) {
    console.error('No players found. Aborting data collection.');
    return [];
  }

  const allGames = [];
  let processedCount = 0;

  for (const player of players) {
    processedCount++;
    console.log(`[${processedCount}/${players.length}] Fetching games for ${player.name}...`);

    // Fetch both current and previous season for more data
    const currentSeasonGames = await fetchPlayerGameLogs(player.id, player.name, '2025-26');
    await delay(300); // Small delay between season requests
    const previousSeasonGames = await fetchPlayerGameLogs(player.id, player.name, '2024-25');

    allGames.push(...currentSeasonGames, ...previousSeasonGames);

    // Rate limiting - wait 600ms between players to avoid 429 errors
    await delay(600);

    // Progress update every 50 players
    if (processedCount % 50 === 0) {
      console.log(`  Progress: ${processedCount}/${players.length} players processed, ${allGames.length} games collected`);
    }
  }

  console.log(`\n✓ Collected ${allGames.length} games from ${players.length} players`);
  return allGames;
}

/**
 * Load existing training data
 */
async function loadExistingData() {
  console.log('\n=== Loading Existing Training Data ===\n');

  try {
    const exists = await fs.access(EXISTING_DATA_FILE).then(() => true).catch(() => false);
    if (!exists) {
      console.log('No existing data file found. Will use only fresh data.');
      return [];
    }

    // Check environment variable to skip loading large existing file
    if (process.env.SKIP_EXISTING_DATA === 'true') {
      console.log('⏭  Skipping existing data (using only fresh data) to save memory');
      return [];
    }

    console.log('⚠️  Loading large existing dataset (576K+ rows)...');
    console.log('   This may take 1-2 minutes and use ~4GB RAM');
    console.log('   Tip: Set SKIP_EXISTING_DATA=true to use only fresh data\n');

    const csvContent = await fs.readFile(EXISTING_DATA_FILE, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      console.log('Existing data file is empty.');
      return [];
    }

    const headers = lines[0].split(',');
    const data = [];

    console.log(`   Processing ${lines.length - 1} rows...`);

    // Process in chunks to help with memory
    const CHUNK_SIZE = 50000;
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index];
      });
      data.push(row);

      // Progress update every chunk
      if (i % CHUNK_SIZE === 0) {
        console.log(`   Processed ${i}/${lines.length - 1} rows...`);
      }
    }

    console.log(`✓ Loaded ${data.length} existing games`);
    return data;
  } catch (error) {
    console.error('Error loading existing data:', error.message);
    console.log('⚠️  Continuing with only fresh data...');
    return [];
  }
}

/**
 * Combine and deduplicate data
 */
function combineData(existingData, newData) {
  console.log('\n=== Combining Datasets ===\n');

  // Use game_id + player_id as unique key
  const gameMap = new Map();

  // Add existing data
  for (const game of existingData) {
    const key = `${game.game_id}_${game.player_id}`;
    gameMap.set(key, game);
  }

  // Add new data (will overwrite if duplicate)
  for (const game of newData) {
    const key = `${game.game_id}_${game.player_id}`;
    gameMap.set(key, game);
  }

  const combined = Array.from(gameMap.values());
  console.log(`✓ Combined dataset: ${combined.length} unique games`);
  console.log(`  - Existing games: ${existingData.length}`);
  console.log(`  - New games: ${newData.length}`);
  console.log(`  - Duplicates removed: ${existingData.length + newData.length - combined.length}`);

  return combined;
}

/**
 * Save combined data to CSV
 */
async function saveToCSV(data, outputPath) {
  console.log('\n=== Saving Combined Data ===\n');

  if (data.length === 0) {
    console.error('No data to save!');
    return;
  }

  // Get all unique keys from all objects
  const allKeys = new Set();
  data.forEach(row => {
    Object.keys(row).forEach(key => allKeys.add(key));
  });

  const headers = Array.from(allKeys);

  // Build CSV content
  let csvContent = headers.join(',') + '\n';

  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      if (value === undefined || value === null) return '';
      // Escape commas and quotes in values
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvContent += values.join(',') + '\n';
  }

  await fs.writeFile(outputPath, csvContent, 'utf8');
  console.log(`✓ Saved ${data.length} games to: ${outputPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   NBA Training Data Collector          ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Step 1: Fetch recent game data
    const recentGames = await fetchRecentGameData();

    if (recentGames.length === 0) {
      console.error('\n✗ Failed to fetch any recent games. Exiting.');
      process.exit(1);
    }

    // Step 2: Load existing data
    const existingGames = await loadExistingData();

    // Step 3: Combine datasets
    const combinedData = combineData(existingGames, recentGames);

    // Step 4: Save to CSV
    await saveToCSV(combinedData, OUTPUT_FILE);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   Data Collection Complete! ✓          ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log(`Output file: ${OUTPUT_FILE}`);
    console.log(`Total games: ${combinedData.length}`);
    console.log(`\nNext step: Run feature engineering pipeline`);
    console.log(`  → node backend/ml/featureEngineering.js\n`);

  } catch (error) {
    console.error('\n✗ Error during data collection:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchRecentGameData, loadExistingData, combineData };
