/**
 * Refresh Player Headshots
 *
 * Downloads the latest NBA.com headshot for every player on a current roster
 * and overwrites the local copy in public/images/players/ when it changed.
 * NBA.com updates headshots each season (new teams, new uniforms), but the
 * app only downloads an image once, so run this at the start of each season.
 *
 * Existing files saved under a different spelling of a player's name
 * (e.g. "nicolas_claxton" vs NBA.com's "Nic Claxton") are refreshed too.
 *
 * Usage:
 *   node backend/scripts/refreshPlayerHeadshots.js            # Refresh all
 *   node backend/scripts/refreshPlayerHeadshots.js --dry-run  # Report only
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLocalImagePath } from '../services/imageStorageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, '../public/images/players');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 8;

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com'
};

function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() + 1 < 10
    ? `${year - 1}-${String(year).slice(-2)}`
    : `${year}-${String(year + 1).slice(-2)}`;
}

const stemOf = (name) => path.basename(getLocalImagePath(name), '.png');

async function fetchCurrentPlayers() {
  const response = await axios.get('https://stats.nba.com/stats/commonallplayers', {
    params: { LeagueID: '00', Season: getCurrentSeason(), IsOnlyCurrentSeason: 1 },
    headers: NBA_HEADERS,
    timeout: 30000
  });
  const { headers, rowSet } = response.data.resultSets[0];
  const idIdx = headers.indexOf('PERSON_ID');
  const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
  return rowSet.map(row => ({ id: row[idIdx], name: row[nameIdx], stem: stemOf(row[nameIdx]) }));
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const stripSuffix = (stem) => stem.split('_').filter(part => !SUFFIXES.has(part));

/**
 * Match an existing file stem that isn't an exact NBA.com name, e.g.
 * "nicolas_claxton" -> "nic_claxton" or "jimmy_butler" -> "jimmy_butler_iii".
 * Ignores name suffixes, requires the same last name and one first name to be
 * a prefix of the other, and exactly one candidate.
 */
function matchAlias(stem, players) {
  const parts = stripSuffix(stem);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts.slice(1).join('_');
  const candidates = players.filter(p => {
    const pParts = stripSuffix(p.stem);
    const pFirst = pParts[0];
    const pLast = pParts.slice(1).join('_');
    return pLast === last && (pFirst.startsWith(first) || first.startsWith(pFirst));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function downloadHeadshot(nbaId) {
  const response = await axios.get(`https://cdn.nba.com/headshots/nba/latest/260x190/${nbaId}.png`, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { 'User-Agent': NBA_HEADERS['User-Agent'] }
  });
  return Buffer.from(response.data);
}

async function main() {
  const players = await fetchCurrentPlayers();
  const byStem = new Map(players.map(p => [p.stem, p]));
  console.log(`Found ${players.length} players on ${getCurrentSeason()} rosters`);

  // Targets: one canonical file per current player, plus existing alias files
  const targets = new Map(players.map(p => [p.stem, p]));
  const existingStems = fs.readdirSync(IMAGES_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => f.slice(0, -4));
  const unmatched = [];
  for (const stem of existingStems) {
    if (byStem.has(stem)) continue;
    const match = matchAlias(stem, players);
    if (match) targets.set(stem, match);
    else unmatched.push(stem);
  }

  const counts = { updated: 0, added: 0, unchanged: 0, failed: 0 };
  const failures = [];
  const queue = [...targets.entries()];

  async function worker() {
    while (queue.length > 0) {
      const [stem, player] = queue.shift();
      const filePath = path.join(IMAGES_DIR, `${stem}.png`);
      try {
        const image = await downloadHeadshot(player.id);
        const exists = fs.existsSync(filePath);
        if (exists && fs.readFileSync(filePath).equals(image)) {
          counts.unchanged++;
          continue;
        }
        if (!DRY_RUN) fs.writeFileSync(filePath, image);
        counts[exists ? 'updated' : 'added']++;
      } catch (error) {
        counts.failed++;
        failures.push(`${stem} (${player.name}, ${player.id}): ${error.response?.status || error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`${DRY_RUN ? '[dry run] ' : ''}Updated ${counts.updated}, added ${counts.added}, unchanged ${counts.unchanged}, failed ${counts.failed}`);
  if (failures.length) console.log(`Failed:\n  ${failures.join('\n  ')}`);
  if (unmatched.length) {
    console.log(`Not on a current roster, left as-is (${unmatched.length}):\n  ${unmatched.sort().join(', ')}`);
  }
}

main().catch(error => {
  console.error('Headshot refresh failed:', error.message);
  process.exit(1);
});
