/**
 * Game Outcome Prediction Service
 *
 * METHODOLOGY:
 * 1. Point Differential Model — The strongest single predictor of NBA game outcomes.
 *    Uses each team's season avgPointsFor and avgPointsAgainst to compute net rating,
 *    then converts the differential to an expected spread via Pythagorean formula.
 *
 * 2. Win% Power Rating — Adjusts for teams that outperform their point differential
 *    (clutch play, close-game record). Uses log5 method to compute head-to-head probability.
 *
 * 3. Home Court Advantage — Base ~2.5 pts (reduced because net ratings already include
 *    home/away games). Further adjusted based on each team's actual home/away win% splits.
 *
 * 4. Recent Form — 10-game streak factor. Hot/cold streaks shift the line modestly.
 *
 * 5. Injury Adjustments — Players rated 0-100 impact score from actual game stats.
 *    "Out" players get full penalty; "Questionable" get 40% penalty (most play).
 *
 * 6. Vegas Calibration — When available, final prediction is 55% Vegas / 45% model.
 *    Vegas lines are the most efficient predictor available, but blending our
 *    injury/momentum signals adds value on game-day.
 *
 * SPREAD COMPOSITION (model-only, before Vegas blend):
 *   - Point differential model: 65% weight
 *   - Win% log5 model: 35% weight
 *   - Home court advantage: fixed +3.0 (adjusted by home/away splits)
 *   - Streak momentum: up to ±1.5 pts
 *   - Injury adjustment: variable (capped at ±8 pts)
 */

import NodeCache from 'node-cache';
import { getTeamStats, getTeamInfo, getEspnTeamId } from './nbaApiService.js';
import { getMatchupInjuries } from './injuryService.js';

const predictionCache = new NodeCache({ stdTTL: 1800, useClones: false }); // 30 min

/**
 * Calculate team offensive/defensive efficiency from per-game stats
 * Returns net rating (points scored - points allowed per game)
 */
function getNetRating(info) {
  const ppg = parseFloat(info?.avgPointsFor) || 0;
  const oppPpg = parseFloat(info?.avgPointsAgainst) || 0;
  if (!ppg || !oppPpg) return 0;
  return ppg - oppPpg;
}

/**
 * Convert net rating differential to expected spread
 * Research: 1 point of net rating differential ≈ 1 point of spread
 * (This is well-established in NBA analytics)
 */
function netRatingToSpread(homeNetRating, awayNetRating) {
  return homeNetRating - awayNetRating;
}

/**
 * Log5 method: compute head-to-head win probability from two team win%
 * Formula: P(A beats B) = (pA - pA*pB) / (pA + pB - 2*pA*pB)
 * Returns home team's win probability (0-1)
 */
function log5WinProb(homeWinPct, awayWinPct) {
  const h = Math.max(0.01, Math.min(0.99, homeWinPct));
  const a = Math.max(0.01, Math.min(0.99, awayWinPct));
  return (h - h * a) / (h + a - 2 * h * a);
}

/**
 * Convert win probability to point spread
 * Based on NBA historical data: 50% = 0, ~65% ≈ -5, ~75% ≈ -8
 * Using probit approximation calibrated to NBA spreads
 */
function winProbToSpread(prob) {
  // Logit transform scaled to NBA spread range
  const p = Math.max(0.02, Math.min(0.98, prob));
  return -Math.log(p / (1 - p)) * 3.3;
}

/**
 * Calculate team strength composite score (20-80 scale) for display
 */
function calculateTeamStrength(stats, info) {
  if (!info?.winPct && (!stats || !stats.ppg)) return 50;

  let score = 0;
  let weights = 0;

  // Win% (strongest signal) — weight 35
  const winPct = parseFloat(info?.winPct) || 0.5;
  score += (winPct * 60 + 20) * 35; // Maps 0.0→20, 0.5→50, 1.0→80
  weights += 35;

  // Point differential (second strongest) — weight 30
  const netRating = getNetRating(info);
  // NBA net ratings range roughly -12 to +12
  const netNorm = Math.max(0, Math.min(1, (netRating + 12) / 24));
  score += (netNorm * 60 + 20) * 30;
  weights += 30;

  // Offensive efficiency — weight 20
  const ppg = parseFloat(stats?.ppg) || 110;
  const fgPct = parseFloat(stats?.fgPct) || 45;
  const offNorm = Math.max(0, Math.min(1,
    ((ppg - 100) / 25) * 0.6 + ((fgPct - 42) / 10) * 0.4
  ));
  score += (offNorm * 60 + 20) * 20;
  weights += 20;

  // Defensive stats — weight 15
  const spg = parseFloat(stats?.spg) || 7;
  const bpg = parseFloat(stats?.bpg) || 4;
  const topg = parseFloat(stats?.topg) || 14;
  const defNorm = Math.max(0, Math.min(1,
    ((spg - 5) / 6) * 0.35 + ((bpg - 3) / 5) * 0.35 + ((18 - topg) / 8) * 0.3
  ));
  score += (defNorm * 60 + 20) * 15;
  weights += 15;

  return Math.round(score / weights);
}

/**
 * Estimate game total using both teams' offensive and defensive profiles
 */
function estimateTotal(homeStats, awayStats, homeInfo, awayInfo) {
  // Method 1: Average of PPG (what each team scores)
  const homePpg = parseFloat(homeInfo?.avgPointsFor || homeStats?.ppg) || 110;
  const awayPpg = parseFloat(awayInfo?.avgPointsFor || awayStats?.ppg) || 110;

  // Method 2: Factor in defensive strength (opponent PPG)
  const homeOppPpg = parseFloat(homeInfo?.avgPointsAgainst) || 110;
  const awayOppPpg = parseFloat(awayInfo?.avgPointsAgainst) || 110;

  // Expected points for each team = (team PPG + opponent's opp PPG) / 2
  // This accounts for matchup: a great offense vs great defense regresses
  const leagueAvgPpg = 112.5; // 2025-26 NBA average
  const homeExpected = (homePpg + awayOppPpg) / 2;
  const awayExpected = (awayPpg + homeOppPpg) / 2;
  const matchupTotal = homeExpected + awayExpected;

  // Regress 20% toward league average total (225)
  return Math.round((matchupTotal * 0.8 + (leagueAvgPpg * 2) * 0.2) * 10) / 10;
}

/**
 * Convert American odds to implied probability
 */
function americanToProb(odds) {
  if (!odds || odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

/**
 * Calculate injury penalty in points
 * "Out" = full penalty, "Questionable" = 40% (most play), "Probable" = ignored
 */
function calcInjuryPenalty(injuryList) {
  let penalty = 0;
  for (const inj of injuryList || []) {
    const status = inj.structuredStatus;
    if (status !== 'out' && status !== 'questionable') continue;

    const impact = inj.impactScore || 50;
    const statusMultiplier = status === 'out' ? 1.0 : 0.4;

    // Scale impact to point penalty
    // MVP (100) = 5.0 pts, Star (90) = 3.5 pts, Starter (80) = 2.0 pts, Role (65) = 0.8 pts
    let basePenalty;
    if (impact >= 95) basePenalty = 5.0;
    else if (impact >= 90) basePenalty = 3.5;
    else if (impact >= 80) basePenalty = 2.0;
    else if (impact >= 70) basePenalty = 1.2;
    else if (impact >= 60) basePenalty = 0.6;
    else basePenalty = 0.3;

    penalty += basePenalty * statusMultiplier;
  }
  // Cap total injury penalty at 8 points (even if half the roster is out,
  // NBA depth means diminishing returns beyond ~8 pts)
  return Math.min(penalty, 8.0);
}

/**
 * Predict game outcome
 * @param {string} homeAbbrev - Home team abbreviation (e.g., 'BOS')
 * @param {string} awayAbbrev - Away team abbreviation (e.g., 'LAL')
 * @param {object} options - { vegasOdds } optional Vegas data for calibration
 */
export async function predictGameOutcome(homeAbbrev, awayAbbrev, options = {}) {
  const { vegasOdds } = options;
  const hasVegas = !!vegasOdds?.spread?.line;
  const cacheKey = `game_pred:${homeAbbrev}:${awayAbbrev}:${hasVegas ? 'v' : 'n'}`;

  const cached = predictionCache.get(cacheKey);
  if (cached) return cached;

  try {
    const homeEspnId = getEspnTeamId(homeAbbrev);
    const awayEspnId = getEspnTeamId(awayAbbrev);

    // Fetch team stats, info, and injuries in parallel
    const [homeStatsRes, awayStatsRes, homeInfoRes, awayInfoRes, injuriesRes] = await Promise.allSettled([
      homeEspnId ? getTeamStats(homeEspnId) : Promise.resolve({}),
      awayEspnId ? getTeamStats(awayEspnId) : Promise.resolve({}),
      homeEspnId ? getTeamInfo(homeEspnId) : Promise.resolve({}),
      awayEspnId ? getTeamInfo(awayEspnId) : Promise.resolve({}),
      getMatchupInjuries(homeAbbrev, awayAbbrev)
    ]);

    const homeStats = homeStatsRes.status === 'fulfilled' ? homeStatsRes.value : {};
    const awayStats = awayStatsRes.status === 'fulfilled' ? awayStatsRes.value : {};
    const homeInfo = homeInfoRes.status === 'fulfilled' ? homeInfoRes.value : {};
    const awayInfo = awayInfoRes.status === 'fulfilled' ? awayInfoRes.value : {};
    const injuries = injuriesRes.status === 'fulfilled' ? injuriesRes.value : {};

    // ========================================
    // FACTOR 1: Point Differential Spread (50%)
    // ========================================
    const homeNetRating = getNetRating(homeInfo);
    const awayNetRating = getNetRating(awayInfo);
    const diffSpread = netRatingToSpread(homeNetRating, awayNetRating);

    // ========================================
    // FACTOR 2: Win% Log5 Spread (35%)
    // ========================================
    const homeWinPct = parseFloat(homeInfo?.winPct) || 0.5;
    const awayWinPct = parseFloat(awayInfo?.winPct) || 0.5;
    const log5Prob = log5WinProb(homeWinPct, awayWinPct);
    const log5Spread = -winProbToSpread(log5Prob); // negative = home favored

    // ========================================
    // FACTOR 3: Home Court Advantage
    // ========================================
    // Base: 2.5 pts (reduced from 3.0 since net ratings already include home/away games).
    // Adjust by how much better/worse each team is at home vs away.
    const homeHomePct = parseFloat(homeInfo?.homeWinPct) || homeWinPct;
    const awayAwayPct = parseFloat(awayInfo?.awayWinPct) || awayWinPct;
    // If home team is much better at home (+10% above overall), boost HCA
    const homeBoost = (homeHomePct - homeWinPct) * 4; // +/- up to ~1.5 pts
    const awayPenalty = (awayWinPct - awayAwayPct) * 4; // teams worse on road
    const homeCourt = Math.max(1.0, Math.min(4.5, 2.5 + homeBoost + awayPenalty));

    // ========================================
    // FACTOR 4: Recent Form / Momentum
    // ========================================
    const homeStreak = parseFloat(homeInfo?.streak) || 0; // positive = wins
    const awayStreak = parseFloat(awayInfo?.streak) || 0;
    // Each game in a streak is worth ~0.15 pts, capped at ±1.5
    const streakAdj = Math.max(-1.5, Math.min(1.5, (homeStreak - awayStreak) * 0.15));

    // ========================================
    // FACTOR 5: Injury Adjustments
    // ========================================
    const homeInjuries = injuries.playerTeamInjuries || [];
    const awayInjuries = injuries.opponentInjuries || [];
    const homeInjuryPenalty = calcInjuryPenalty(homeInjuries);
    const awayInjuryPenalty = calcInjuryPenalty(awayInjuries);
    const injuryAdj = awayInjuryPenalty - homeInjuryPenalty; // positive = benefits home

    // ========================================
    // COMBINED MODEL SPREAD
    // ========================================
    // Weighted blend: 65% point diff, 35% win%, then add fixed factors
    const baseSpread = (diffSpread * 0.65) + (log5Spread * 0.35);
    const modelSpread = baseSpread + homeCourt + streakAdj + injuryAdj;

    // Model total
    const modelTotal = estimateTotal(homeStats, awayStats, homeInfo, awayInfo);

    // ========================================
    // VEGAS CALIBRATION (55% Vegas, 45% model)
    // ========================================
    let finalSpread, finalTotal;
    if (hasVegas) {
      const vegasSpread = vegasOdds.spread.line;
      const vegasTotal = vegasOdds.totals?.line || modelTotal;
      finalSpread = Math.round((vegasSpread * 0.55 + modelSpread * 0.45) * 10) / 10;
      finalTotal = Math.round((vegasTotal * 0.55 + modelTotal * 0.45) * 10) / 10;
    } else {
      finalSpread = Math.round(modelSpread * 10) / 10;
      finalTotal = Math.round(modelTotal * 10) / 10;
    }

    // Win probability from spread (logistic function calibrated to NBA)
    // k=0.148 maps: spread 3→66%, spread 7→78%, spread 10→87%
    const homeWinProb = Math.round(1 / (1 + Math.exp(-0.148 * finalSpread)) * 1000) / 10;
    const awayWinProb = Math.round((100 - homeWinProb) * 10) / 10;

    // Team strength scores for display
    const homeStrength = calculateTeamStrength(homeStats, homeInfo);
    const awayStrength = calculateTeamStrength(awayStats, awayInfo);

    // Confidence assessment
    let confidence = 'medium';
    if (hasVegas) {
      const spreadDiff = Math.abs(modelSpread - vegasOdds.spread.line);
      if (spreadDiff < 2) confidence = 'high';
      else if (spreadDiff > 5) confidence = 'low';
    } else {
      // Without Vegas, confidence is based on how decisive the prediction is
      if (Math.abs(modelSpread) > 6) confidence = 'high';
      else if (Math.abs(modelSpread) < 2) confidence = 'low';
    }

    // ========================================
    // BUILD ANALYSIS
    // ========================================
    const analysis = [];
    const favoredTeam = finalSpread < 0 ? awayAbbrev : homeAbbrev;
    const spreadAbs = Math.abs(finalSpread);

    if (spreadAbs > 7) analysis.push(`${favoredTeam} is a strong favorite in this matchup.`);
    else if (spreadAbs > 3) analysis.push(`${favoredTeam} has a moderate edge.`);
    else analysis.push(`This projects as a close, competitive game.`);

    // Point differential context
    if (Math.abs(homeNetRating - awayNetRating) > 3) {
      const betterTeam = homeNetRating > awayNetRating ? homeAbbrev : awayAbbrev;
      const diff = Math.abs(homeNetRating - awayNetRating).toFixed(1);
      analysis.push(`${betterTeam} has a ${diff}-point better net rating this season.`);
    }

    // Record context
    const homeWins = parseFloat(homeInfo?.wins) || 0;
    const homeLosses = parseFloat(homeInfo?.losses) || 0;
    const awayWins = parseFloat(awayInfo?.wins) || 0;
    const awayLosses = parseFloat(awayInfo?.losses) || 0;
    if (homeWins && awayWins) {
      analysis.push(`${homeAbbrev} (${homeWins}-${homeLosses}) vs ${awayAbbrev} (${awayWins}-${awayLosses}).`);
    }

    analysis.push(`Home court advantage: +${homeCourt.toFixed(1)} pts for ${homeAbbrev}.`);

    // Streak context
    if (Math.abs(homeStreak) >= 3 || Math.abs(awayStreak) >= 3) {
      if (homeStreak >= 3) analysis.push(`${homeAbbrev} is on a ${homeStreak}-game win streak.`);
      if (homeStreak <= -3) analysis.push(`${homeAbbrev} has lost ${Math.abs(homeStreak)} straight.`);
      if (awayStreak >= 3) analysis.push(`${awayAbbrev} is on a ${awayStreak}-game win streak.`);
      if (awayStreak <= -3) analysis.push(`${awayAbbrev} has lost ${Math.abs(awayStreak)} straight.`);
    }

    if (homeInjuryPenalty > 1.5) {
      analysis.push(`${homeAbbrev} is impacted by injuries (-${homeInjuryPenalty.toFixed(1)} pts).`);
    }
    if (awayInjuryPenalty > 1.5) {
      analysis.push(`${awayAbbrev} is impacted by injuries (-${awayInjuryPenalty.toFixed(1)} pts).`);
    }

    if (hasVegas) {
      const vegasSpread = vegasOdds.spread.line;
      const modelVsVegas = Math.abs(modelSpread - vegasSpread);
      if (modelVsVegas < 1.5) {
        analysis.push(`Our model closely aligns with Vegas (spread diff: ${modelVsVegas.toFixed(1)} pts).`);
      } else if (modelSpread > vegasSpread + 1.5) {
        analysis.push(`Our model favors ${homeAbbrev} more than Vegas by ${modelVsVegas.toFixed(1)} pts.`);
      } else if (modelSpread < vegasSpread - 1.5) {
        analysis.push(`Our model favors ${awayAbbrev} more than Vegas by ${modelVsVegas.toFixed(1)} pts.`);
      }
    }

    // Vegas comparison
    let vegasComparison = null;
    if (hasVegas) {
      const vegasHomeProb = vegasOdds.moneyline?.home_odds ? americanToProb(vegasOdds.moneyline.home_odds) * 100 : null;
      const vegasAwayProb = vegasOdds.moneyline?.away_odds ? americanToProb(vegasOdds.moneyline.away_odds) * 100 : null;
      vegasComparison = {
        vegasSpread: vegasOdds.spread.line,
        vegasTotal: vegasOdds.totals?.line,
        vegasHomeWinPct: vegasHomeProb ? Math.round(vegasHomeProb * 10) / 10 : null,
        vegasAwayWinPct: vegasAwayProb ? Math.round(vegasAwayProb * 10) / 10 : null,
        modelSpread: Math.round(modelSpread * 10) / 10,
        modelTotal: Math.round(modelTotal * 10) / 10
      };
    }

    const prediction = {
      homeTeam: homeAbbrev,
      awayTeam: awayAbbrev,
      homeWinProb,
      awayWinProb,
      predictedSpread: finalSpread,
      predictedTotal: finalTotal,
      confidence,
      analysis: analysis.join(' '),
      factors: {
        homeStrength,
        awayStrength,
        homeCourt: Math.round(homeCourt * 10) / 10,
        homeNetRating: Math.round(homeNetRating * 10) / 10,
        awayNetRating: Math.round(awayNetRating * 10) / 10,
        streakAdj: Math.round(streakAdj * 10) / 10,
        homeInjuryPenalty: Math.round(homeInjuryPenalty * 10) / 10,
        awayInjuryPenalty: Math.round(awayInjuryPenalty * 10) / 10,
        vegasCalibrated: hasVegas
      },
      injuries: {
        home: homeInjuries.filter(i => i.structuredStatus === 'out' || i.structuredStatus === 'questionable').map(i => ({
          name: i.playerName, status: i.status, impact: i.impactScore || 50
        })),
        away: awayInjuries.filter(i => i.structuredStatus === 'out' || i.structuredStatus === 'questionable').map(i => ({
          name: i.playerName, status: i.status, impact: i.impactScore || 50
        }))
      },
      vegasComparison
    };

    predictionCache.set(cacheKey, prediction);
    return prediction;
  } catch (error) {
    console.error(`[GamePrediction] Error: ${error.message}`);
    return null;
  }
}
