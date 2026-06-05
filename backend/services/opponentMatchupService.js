/**
 * Opponent Matchup Service
 * Fetches and caches opponent team defensive stats for prediction enrichment.
 * Provides matchup context that Vegas lines may not fully price in.
 */

import { getTeamStats, getEspnTeamId } from './nbaApiService.js';
import { getTeamAbbrevFromFullName } from './teamMappingService.js';

// In-memory cache: abbrev -> { stats, fetchedAt }
const defenseCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// League-average baselines (2025-26 approximate) used for normalization
const LEAGUE_AVG = {
  ppg: 114,    // points per game
  rpg: 43,     // rebounds per game
  apg: 26,     // assists per game
  spg: 7.5,
  bpg: 5,
  topg: 14,
  threePtPct: 0.365,
  fgPct: 0.472,
  pace: 100,   // possessions per game (normalized baseline)
};

/**
 * Fetch opponent team defensive stats and cache them.
 * @param {string} opponentAbbrev - Team abbreviation (e.g. "LAL")
 * @returns {Object|null} Defensive stats object or null if unavailable
 */
export async function getOpponentDefenseStats(opponentAbbrev) {
  if (!opponentAbbrev) return null;

  const abbrev = opponentAbbrev.toUpperCase();
  const cached = defenseCache.get(abbrev);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.stats;
  }

  const espnId = getEspnTeamId(abbrev);
  if (!espnId) return null;

  try {
    const raw = await getTeamStats(espnId);
    if (!raw || !raw.ppg) return null;

    const stats = {
      opp_ppg: parseFloat(raw.ppg) || LEAGUE_AVG.ppg,
      opp_rpg: parseFloat(raw.rpg) || LEAGUE_AVG.rpg,
      opp_apg: parseFloat(raw.apg) || LEAGUE_AVG.apg,
      opp_spg: parseFloat(raw.spg) || LEAGUE_AVG.spg,
      opp_bpg: parseFloat(raw.bpg) || LEAGUE_AVG.bpg,
      opp_topg: parseFloat(raw.topg) || LEAGUE_AVG.topg,
      opp_fg_pct: parseFloat(raw.fgPct) || LEAGUE_AVG.fgPct,
      opp_three_pct: parseFloat(raw.threePtPct) || LEAGUE_AVG.threePtPct,
      opp_def_rpg: parseFloat(raw.defRpg) || 33,
    };

    defenseCache.set(abbrev, { stats, fetchedAt: Date.now() });
    return stats;
  } catch (err) {
    console.warn(`[Matchup] Failed to fetch defense stats for ${abbrev}:`, err.message);
    return null;
  }
}

/**
 * Resolve opponent abbreviation from nextGameInfo and player's team.
 * @param {Object} nextGameInfo - { home_team, away_team, ... }
 * @param {string} playerTeamAbbrev - Player's team abbreviation
 * @returns {string|null} Opponent abbreviation
 */
export function resolveOpponentAbbrev(nextGameInfo, playerTeamAbbrev) {
  if (!nextGameInfo) return null;

  const homeAbbrev = getTeamAbbrevFromFullName(nextGameInfo.home_team);
  const awayAbbrev = getTeamAbbrevFromFullName(nextGameInfo.away_team);

  if (!homeAbbrev || !awayAbbrev) return null;

  // If player is on the home team, opponent is away team and vice versa
  if (playerTeamAbbrev?.toUpperCase() === homeAbbrev) return awayAbbrev;
  if (playerTeamAbbrev?.toUpperCase() === awayAbbrev) return homeAbbrev;

  // Fallback: try matching from game log opponent field
  return null;
}

/**
 * Build matchup features for prediction enrichment.
 * Returns normalized opponent defensive context relative to league average.
 *
 * @param {string} opponentAbbrev - Opponent team abbreviation
 * @param {string} propType - Prop type (points, rebounds, assists, etc.)
 * @returns {Object} Matchup feature object for ML model
 */
export async function buildMatchupFeatures(opponentAbbrev, propType) {
  const defaults = {
    opp_pts_allowed_norm: 0,   // 0 = league average, positive = allows more
    opp_reb_allowed_norm: 0,
    opp_ast_allowed_norm: 0,
    opp_blk_rate: 0,           // blocks per game (rim protection)
    opp_stl_rate: 0,           // steals per game (disruptive defense)
    opp_pace_norm: 0,          // pace relative to average
    opp_def_rating: 0,         // composite defensive quality (-1 to 1, negative = better defense)
  };

  const stats = await getOpponentDefenseStats(opponentAbbrev);
  if (!stats) return defaults;

  // Normalize relative to league average (positive = opponent allows MORE of this stat)
  // Note: for a player prop, higher opp_pts_allowed_norm means easier matchup for scoring
  // ESPN getTeamStats returns the TEAM'S OWN stats, not what they allow.
  // So a team with high ppg has a good offense, but we need DEFENSIVE context.
  // Unfortunately ESPN's basic stats endpoint doesn't split offense/defense.
  // We approximate: a team's own stats indicate their pace and style.
  // For defensive quality, we use blocks + steals + defensive rebounds as proxies.

  // Pace proxy: team's own PPG indicates game pace/tempo
  const paceNorm = (stats.opp_ppg - LEAGUE_AVG.ppg) / LEAGUE_AVG.ppg;

  // Defensive quality proxy (higher blocks + steals + def rebounds = better defense)
  const defComposite = (
    (stats.opp_bpg / LEAGUE_AVG.bpg - 1) * 0.3 +
    (stats.opp_spg / LEAGUE_AVG.spg - 1) * 0.3 +
    (stats.opp_def_rpg / 33 - 1) * 0.2 +
    (stats.opp_topg / LEAGUE_AVG.topg - 1) * -0.2  // more turnovers = worse ball security = weaker offense to play against
  );

  // Turnover rate: opponent creating turnovers = disruptive
  const stlRate = stats.opp_spg / LEAGUE_AVG.spg - 1;
  const blkRate = stats.opp_bpg / LEAGUE_AVG.bpg - 1;

  return {
    opp_pts_allowed_norm: paceNorm,  // higher pace = more scoring opportunities
    opp_reb_allowed_norm: (stats.opp_rpg - LEAGUE_AVG.rpg) / LEAGUE_AVG.rpg,
    opp_ast_allowed_norm: (stats.opp_apg - LEAGUE_AVG.apg) / LEAGUE_AVG.apg,
    opp_blk_rate: blkRate,
    opp_stl_rate: stlRate,
    opp_pace_norm: paceNorm,
    opp_def_rating: -defComposite,  // negative = tougher defense for the opponent player
  };
}

/**
 * Get a simple matchup edge score for a specific prop type.
 * Positive = favorable matchup (opponent is weak defensively for this stat).
 * Negative = tough matchup.
 *
 * @param {Object} matchupFeatures - From buildMatchupFeatures()
 * @param {string} propType - Prop type
 * @returns {number} Edge score (-1 to 1 range typically)
 */
export function getMatchupEdge(matchupFeatures, propType) {
  if (!matchupFeatures) return 0;

  switch (propType) {
    case 'points':
      // High pace + weak rim protection = scoring opportunity
      return matchupFeatures.opp_pace_norm * 0.4 +
             (-matchupFeatures.opp_blk_rate) * 0.3 +
             (-matchupFeatures.opp_stl_rate) * 0.3;
    case 'rebounds':
      return matchupFeatures.opp_reb_allowed_norm * 0.5 +
             matchupFeatures.opp_pace_norm * 0.3 +
             (-matchupFeatures.opp_blk_rate) * 0.2;
    case 'assists':
      return matchupFeatures.opp_ast_allowed_norm * 0.4 +
             matchupFeatures.opp_pace_norm * 0.3 +
             (-matchupFeatures.opp_stl_rate) * 0.3;
    case 'threes':
    case 'threes_made':
      return matchupFeatures.opp_pace_norm * 0.4 +
             (-matchupFeatures.opp_stl_rate) * 0.3 +
             matchupFeatures.opp_def_rating * 0.3;
    case 'pra':
    case 'points_rebounds_assists':
      return matchupFeatures.opp_pace_norm * 0.5 +
             matchupFeatures.opp_def_rating * 0.3 +
             (-matchupFeatures.opp_blk_rate) * 0.2;
    case 'pr':
    case 'points_rebounds':
      return matchupFeatures.opp_pace_norm * 0.4 +
             matchupFeatures.opp_reb_allowed_norm * 0.3 +
             (-matchupFeatures.opp_blk_rate) * 0.3;
    case 'pa':
    case 'points_assists':
      return matchupFeatures.opp_pace_norm * 0.4 +
             matchupFeatures.opp_ast_allowed_norm * 0.3 +
             (-matchupFeatures.opp_stl_rate) * 0.3;
    case 'ra':
    case 'rebounds_assists':
      return matchupFeatures.opp_reb_allowed_norm * 0.3 +
             matchupFeatures.opp_ast_allowed_norm * 0.3 +
             matchupFeatures.opp_pace_norm * 0.2 +
             matchupFeatures.opp_def_rating * 0.2;
    default:
      return 0;
  }
}
