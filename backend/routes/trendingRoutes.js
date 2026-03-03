import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import {
  getPropBookCount,
  findBestOdds,
  getPropSportsbooks,
  sortByBookCount
} from '../utils/trendingHelpers.js';
import { getTeamAbbrevFromFullName } from '../services/teamMappingService.js';

dotenv.config();

const router = express.Router();

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Cache trending props for 5 minutes
const trendingCache = new NodeCache({ stdTTL: 300 });

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

    // Step 1: Get all NBA events
    const eventsResponse = await axios.get(`${THE_ODDS_API_BASE}/sports/basketball_nba/events`, {
      params: { apiKey: THE_ODDS_API_KEY },
      timeout: 15000
    });

    if (!eventsResponse.data || !Array.isArray(eventsResponse.data)) {
      return res.json([]);
    }

    const events = eventsResponse.data.slice(0, 10); // Limit to first 10 events

    const trendingPropsMap = new Map(); // Key: "playerName|propType|line"

    // Step 2: For each event, get all player props (with delay to avoid 429 rate limits)
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (i > 0) await delay(250); // 250ms between requests to avoid rate limiting
      try {
        const oddsResponse = await axios.get(
          `${THE_ODDS_API_BASE}/sports/basketball_nba/events/${event.id}/odds`,
          {
            params: {
              apiKey: THE_ODDS_API_KEY,
              regions: 'us',
              markets: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists',
              oddsFormat: 'american'
            },
            timeout: 10000
          }
        );

        if (!oddsResponse.data || !oddsResponse.data.bookmakers) {
          continue;
        }


        // Step 3: Extract all player props and count sportsbooks per line
        for (const bookmaker of oddsResponse.data.bookmakers) {
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
      } catch (err) {
        const status = err.response?.status;
        const errorCode = err.response?.data?.error_code;
        if (status === 401 || status === 403 || errorCode === 'OUT_OF_USAGE_CREDITS') {
          console.log(`❌ Odds API quota/auth error (${status}). Stopping trending analysis.`);
          break;
        }
        console.log(`⚠️ Error processing event ${event.id}:`, err.message);
        continue;
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
        event_id: propData.event_id
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

export { router as trendingRoutes };

