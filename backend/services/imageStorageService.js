import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create images directory if it doesn't exist
const IMAGES_DIR = path.join(__dirname, '../public/images/players');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * Normalize player name for filename
 */
function normalizeForFilename(name) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .trim();
}

/**
 * Get local image path for a player
 */
export function getLocalImagePath(playerName) {
  const filename = `${normalizeForFilename(playerName)}.png`;
  return path.join(IMAGES_DIR, filename);
}

const NAME_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

/**
 * Find the saved image filename for a player, tolerating name suffixes:
 * sportsbooks say "Paul Reed Jr" where the file is paul_reed.png, and
 * NBA.com says "Jimmy Butler III" where the file is jimmy_butler.png.
 */
function findImageFilename(playerName) {
  const stem = normalizeForFilename(playerName);
  const parts = stem.split('_');
  const baseParts = NAME_SUFFIXES.includes(parts[parts.length - 1]) ? parts.slice(0, -1) : parts;
  const base = baseParts.join('_');
  const candidates = [stem, base, ...NAME_SUFFIXES.map(suffix => `${base}_${suffix}`)];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(IMAGES_DIR, `${candidate}.png`))) return `${candidate}.png`;
  }
  return null;
}

/**
 * Get image URL for frontend
 */
export function getImageUrl(playerName) {
  const filename = findImageFilename(playerName) || `${normalizeForFilename(playerName)}.png`;
  return `/images/players/${filename}`;
}

/**
 * Check if image exists locally
 */
export function imageExists(playerName) {
  return findImageFilename(playerName) !== null;
}

/**
 * Download and save player image
 */
export async function downloadPlayerImage(playerName, nbaPlayerId) {
  try {
    // Full-size original; the refresh script stores sharper 520x380 copies for everyone on a roster
    const imageUrl = `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;
    const imagePath = getLocalImagePath(playerName);
    
    // Skip if image already exists
    if (fs.existsSync(imagePath)) {
      return getImageUrl(playerName);
    }
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    // Save image to disk
    fs.writeFileSync(imagePath, response.data);
    
    return getImageUrl(playerName);
  } catch (error) {
    return null;
  }
}

/**
 * Batch download images for multiple players
 */
export async function downloadPlayerImages(players) {
  const results = [];
  
  for (const player of players) {
    if (player.nba_id) {
      const imageUrl = await downloadPlayerImage(player.name, player.nba_id);
      if (imageUrl) {
        results.push({ name: player.name, image_url: imageUrl });
      }
    }
  }
  
  return results;
}

