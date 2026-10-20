import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import {
  getPropBookCount,
  findBestOdds,
  getPropSportsbooks,
  sortByBookCount,
  getMarketOverPct
} from '../utils/trendingHelpers.js';
import { getTeamAbbrevFromFullName } from '../services/teamMappingService.js';
import { getAllEventOdds } from '../services/oddsEventCache.js';
import { getBestBets } from '../services/bestBetsService.js';
import { onBatchPredictionsComplete } from '../services/batchPredictionCron.js';

dotenv.config();

const router = express.Router();

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Cache trending props for 5 minutes
const trendingCache = new NodeCache({ stdTTL: 300 });
// A finished slate run may have re-predicted props; serve fresh best bets
onBatchPredictionsComplete(() => trendingCache.del('best_bets'));

/**
 * GET /api/trending/props
 * Get trending props based on sportsbook count (most market activity)
 */
router.get('/props', async (req, res) => {
  try {
    if (!THE_ODDS_API_KEY) {
      return res.json([]);
    }

    // Check cache first
    const cached = trendingCache.get('trending_props');
    if (cached) {
      return res.json(cached);
    }

    // All events' props for every relevant book, from the shared cache
    const eventOdds = await getAllEventOdds();

    const trendingPropsMap = new Map(); // Key: "playerName|propType|line"

    for (const { event, data } of eventOdds) {
      for (const bookmaker of data.bookmakers) {
        const sportsbookName = bookmaker.title || bookmaker.key;

        for (const market of bookmaker.markets || []) {
          const propTypeKey = market.key;
          let propType = propTypeKey.replace('player_', '');
          
          // Map prop types
          const propTypeMap = {
            'points': 'points',
            'rebounds': 'rebounds',
            'assists': 'assists',
            'threes': 'threes',
            'points_rebounds_assists': 'pra',
            'points_rebounds': 'pr',
            'points_assists': 'pa',
            'rebounds_assists': 'ra'
          };
          propType = propTypeMap[propType] || propType;

          for (const outcome of market.outcomes || []) {
            const playerName = outcome.description;
            const line = parseFloat(outcome.point);
            const odds = outcome.price;

            if (!playerName || isNaN(line) || line <= 0) continue;

            // Create unique key for this player/prop/line combination
            const key = `${playerName.toLowerCase()}|${propType}|${line}`;

            if (!trendingPropsMap.has(key)) {
              trendingPropsMap.set(key, {
                player: playerName,
                propType: propType,
                line: line,
                event_id: event.id,
                home_team: event.home_team,
                away_team: event.away_team,
                commence_time: event.commence_time,
                sportsbooks: new Map() // Map of sportsbook → { over, under }
              });
            }

            const propData = trendingPropsMap.get(key);
            
            // Initialize sportsbook entry if needed
            if (!propData.sportsbooks.has(sportsbookName)) {
              propData.sportsbooks.set(sportsbookName, {});
            }

            const bookData = propData.sportsbooks.get(sportsbookName);
            
            // Store over/under odds
            if (outcome.name === 'Over') {
              bookData.over = { line, odds };
            } else if (outcome.name === 'Under') {
              bookData.under = { line, odds };
            }
          }
        }
      }
    }

    // Step 4: Convert to array and calculate metrics
    const trendingPropsArray = [];

    for (const [key, propData] of trendingPropsMap.entries()) {
      const bookCount = propData.sportsbooks.size;

      // Only include props with at least 2 sportsbooks (lowered from 3)
      if (bookCount < 2) continue;

      // Convert sportsbooks Map to plain object for helper functions
      const sportsbooksObj = {};
      for (const [book, data] of propData.sportsbooks.entries()) {
        sportsbooksObj[book] = data;
      }

      const bestOdds = findBestOdds(sportsbooksObj);
      const booksList = Array.from(propData.sportsbooks.keys());
      const marketOverPct = getMarketOverPct(sportsbooksObj);

      // Convert full team names to abbreviations
      const homeTeamAbbrev = getTeamAbbrevFromFullName(propData.home_team) || propData.home_team;
      const awayTeamAbbrev = getTeamAbbrevFromFullName(propData.away_team) || propData.away_team;

      trendingPropsArray.push({
        player: propData.player,
        prop_type: propData.propType,
        line: propData.line,
        bookCount: bookCount,
        books: booksList,
        bestOdds: bestOdds,
        home_team: homeTeamAbbrev,
        away_team: awayTeamAbbrev,
        event_id: propData.event_id,
        commence_time: propData.commence_time,
        market_over_pct: marketOverPct
      });
    }

    // Step 5: Sort by book count and take top 15
    const sortedProps = sortByBookCount(trendingPropsArray).slice(0, 15);

    if (sortedProps.length === 0) {
      return res.json([]);
    }

    // Step 6: Add player images (download missing ones)
    const { getImageUrl, imageExists, downloadPlayerImage } = await import('../services/imageStorageService.js');
    const { searchPlayer } = await import('../services/nbaApiService.js');

    const missingImagePlayers = [];
    for (const prop of sortedProps) {
      try {
        if (imageExists(prop.player)) {
          prop.player_image = getImageUrl(prop.player);
        } else {
          prop.player_image = null;
          missingImagePlayers.push(prop);
        }
      } catch (error) {
        prop.player_image = null;
      }
    }

    // Download missing images in background (don't block response)
    if (missingImagePlayers.length > 0) {
      await Promise.allSettled(
        missingImagePlayers.map(async (prop) => {
          try {
            const nbaPlayer = await Promise.race([
              searchPlayer(prop.player),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
            ]);
            if (nbaPlayer?.id) {
              const imageUrl = await downloadPlayerImage(prop.player, nbaPlayer.id);
              if (imageUrl) {
                prop.player_image = imageUrl;
              }
            }
          } catch (e) {
            // Skip - will show initials
          }
        })
      );
    }

    // Cache the result
    trendingCache.set('trending_props', sortedProps);

    res.json(sortedProps);

  } catch (error) {
    console.error('❌ Error fetching trending props:', error.message);
    res.status(500).json({ error: 'Failed to fetch trending props' });
  }
});

// Best bets: 10 minutes, or 1 minute while the slate is still being predicted
// Short: the player page re-predicts (and re-stores) props as users open them
const BEST_BETS_TTL = 120;
const BEST_BETS_WARMING_TTL = 60;

/**
 * GET /api/trending/best-bets
 * Today's slate picks where the edge model disagrees most with the line.
 */
router.get('/best-bets', async (req, res) => {
  try {
    const cached = trendingCache.get('best_bets');
    if (cached) {
      res.set('Cache-Control', `public, max-age=${BEST_BETS_WARMING_TTL}`);
      return res.json(cached);
    }

    const result = await getBestBets();

    // Headshots already on disk; fetch missing ones briefly, like trending
    const { getImageUrl, imageExists, downloadPlayerImage } = await import('../services/imageStorageService.js');
    const missing = [];
    for (const pick of result.picks) {
      try {
        if (imageExists(pick.player)) pick.player_image = getImageUrl(pick.player);
        else missing.push(pick);
      } catch {
        pick.player_image = null;
      }
    }
    if (missing.length) {
      const { searchPlayer } = await import('../services/nbaApiService.js');
      await Promise.allSettled(missing.map(async (pick) => {
        try {
          const nbaPlayer = await Promise.race([
            searchPlayer(pick.player),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]);
          if (nbaPlayer?.id) pick.player_image = await downloadPlayerImage(pick.player, nbaPlayer.id) || null;
        } catch {
          // Card shows initials
        }
      }));
    }

    const ttl = result.warming ? BEST_BETS_WARMING_TTL : BEST_BETS_TTL;
    trendingCache.set('best_bets', result, ttl);
    res.set('Cache-Control', `public, max-age=${BEST_BETS_WARMING_TTL}`);
    res.json(result);
  } catch (error) {
    console.error('❌ Error building best bets:', error.message);
    res.status(500).json({ error: 'Failed to build best bets' });
  }
});

export { router as trendingRoutes };

