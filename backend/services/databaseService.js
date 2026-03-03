import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache directory
const CACHE_DIR = join(__dirname, '../data/cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// In-memory cache with TTL
const cache = new NodeCache({ 
  stdTTL: 86400, // Default 24 hours
  checkperiod: 3600, // Check for expired keys every hour
  useClones: false // Better performance
});

// Helper to create cache key
const createKey = (prefix, ...parts) => {
  return `${prefix}:${parts.map(p => String(p).toLowerCase().trim()).join(':')}`;
};

// Helper to create hash from games array (for prediction cache key)
export const createGamesHash = (games) => {
  if (!games || games.length === 0) return '';
  // Create hash from game dates and points (identifies unique game set)
  const hashData = games
    .slice(0, 10) // Use first 10 games
    .map(g => `${g.date || ''}-${g.points || 0}`)
    .join('|');
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashData.length; i++) {
    const char = hashData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
};

// Player Stats Cache (24 hours)
export const playerStatsCache = {
  get: (playerName) => {
    const key = createKey('stats', playerName);
    return cache.get(key) || null;
  },

  set: (playerName, stats, nbaPlayerId = null, teamAbbrev = null) => {
    const key = createKey('stats', playerName);
    cache.set(key, {
      ...stats,
      nba_player_id: nbaPlayerId,
      team_abbrev: teamAbbrev
    }, 86400); // 24 hours
  }
};

// Predictions Cache (24 hours, keyed by games hash)
export const predictionsCache = {
  get: (playerName, gamesHash) => {
    const key = createKey('prediction', playerName, gamesHash);
    return cache.get(key) || null;
  },

  set: (playerName, gamesHash, prediction) => {
    const key = createKey('prediction', playerName, gamesHash);
    cache.set(key, prediction, 86400); // 24 hours
  }
};

// Betting Lines Cache (1 hour - odds change frequently)
export const bettingLinesCache = {
  get: (playerName, teamAbbrev = null, opponentAbbrev = null) => {
    // Try exact match first
    if (teamAbbrev && opponentAbbrev) {
      const key = createKey('odds', playerName, teamAbbrev, opponentAbbrev);
      const result = cache.get(key);
      if (result) return result;
    }
    
    // Fallback to any recent line for this player
    const key = createKey('odds', playerName);
    return cache.get(key) || null;
  },

  set: (playerName, line, bookmaker, source = 'api', eventId = null, teamAbbrev = null, opponentAbbrev = null) => {
    // Store with team/opponent if provided
    if (teamAbbrev && opponentAbbrev) {
      const key = createKey('odds', playerName, teamAbbrev, opponentAbbrev);
      cache.set(key, { line, bookmaker, source, event_id: eventId }, 3600); // 1 hour
    }
    
    // Also store general key for fallback
    const generalKey = createKey('odds', playerName);
    cache.set(generalKey, { line, bookmaker, source, event_id: eventId }, 3600); // 1 hour
  }
};

// Players with Lines Cache (30 minutes - homepage data)
export const playersWithLinesCache = {
  get: () => {
    return cache.get('players_with_lines') || null;
  },

  set: (data) => {
    cache.set('players_with_lines', data, 1800); // 30 minutes
  }
};

// Next Games Cache (6 hours)
export const nextGamesCache = {
  get: (teamAbbrev) => {
    const key = createKey('next_game', teamAbbrev);
    return cache.get(key) || null;
  },

  set: (teamAbbrev, gameData) => {
    const key = createKey('next_game', teamAbbrev);
    cache.set(key, gameData, 21600); // 6 hours
  }
};

// Image Metadata Cache (7 days - images don't change often)
export const imageMetadataCache = {
  get: (playerName) => {
    const key = createKey('image', playerName);
    return cache.get(key) || null;
  },

  set: (playerName, imageUrl, nbaPlayerId = null) => {
    const key = createKey('image', playerName);
    cache.set(key, { imageUrl, nbaPlayerId, hasImage: true }, 604800); // 7 days
  },

  // Mark that we've checked and player has no image
  setNoImage: (playerName) => {
    const key = createKey('image', playerName);
    cache.set(key, { hasImage: false }, 86400); // 24 hours (retry checking)
  }
};

// Cache statistics
export const getCacheStats = () => {
  return cache.getStats();
};

