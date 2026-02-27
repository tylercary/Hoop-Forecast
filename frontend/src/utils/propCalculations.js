/**
 * Utility functions for prop bet calculations
 */

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(americanOdds) {
  if (americanOdds == null || isNaN(americanOdds)) return null;
  if (americanOdds > 0) {
    return (americanOdds / 100) + 1;
  } else {
    return (100 / Math.abs(americanOdds)) + 1;
  }
}

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProbability(americanOdds) {
  if (americanOdds == null || isNaN(americanOdds)) return null;
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

/**
 * Calculate cover probability based on prediction, line, and error margin
 * Uses a normal distribution approximation
 */
export function calculateCoverProbability(prediction, line, errorMargin, isOver = true) {
  if (prediction == null || line == null) return null;
  
  // If we have error margin, use it for probability calculation
  // Otherwise, estimate based on prediction distance from line
  let stdDev = errorMargin || Math.max(2, Math.abs(prediction - line) * 0.3);
  
  // Calculate z-score
  const zScore = (prediction - line) / stdDev;
  
  // Use cumulative distribution function approximation
  // For normal distribution: P(X > line) when isOver = true
  // P(X < line) when isOver = false
  
  // Simple approximation using error function
  const probability = isOver 
    ? 0.5 * (1 + erf(zScore / Math.sqrt(2)))
    : 0.5 * (1 - erf(zScore / Math.sqrt(2)));
  
  return Math.max(0, Math.min(1, probability)) * 100; // Return as percentage
}

/**
 * Error function approximation
 */
function erf(x) {
  // Abramowitz and Stegun approximation
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Calculate Expected Value
 * EV = (cover_probability * payout_multiplier) - (1 - cover_probability)
 * payout_multiplier = decimal_odds - 1
 */
export function calculateExpectedValue(coverProbability, americanOdds) {
  if (coverProbability == null || americanOdds == null) return null;
  
  const prob = coverProbability / 100; // Convert to decimal
  const decimalOdds = americanToDecimal(americanOdds);
  
  if (!decimalOdds) return null;
  
  const payoutMultiplier = decimalOdds - 1;
  const ev = (prob * payoutMultiplier) - (1 - prob);
  
  return ev * 100; // Return as percentage
}

/**
 * Calculate Bet Rating (A+ to F)
 * Based on EV, confidence, and prediction difference
 */
export function calculateBetRating(ev, coverProbability, predictionDiff, confidence) {
  if (ev == null || coverProbability == null) return null;
  
  let score = 0;
  
  // EV component (0-40 points)
  if (ev > 10) score += 40;
  else if (ev > 5) score += 35;
  else if (ev > 2) score += 30;
  else if (ev > 0) score += 25;
  else if (ev > -2) score += 15;
  else if (ev > -5) score += 10;
  else score += 5;
  
  // Cover Probability component (0-30 points)
  if (coverProbability > 70) score += 30;
  else if (coverProbability > 60) score += 25;
  else if (coverProbability > 55) score += 20;
  else if (coverProbability > 50) score += 15;
  else if (coverProbability > 45) score += 10;
  else score += 5;
  
  // Prediction difference component (0-20 points)
  if (predictionDiff != null) {
    const absDiff = Math.abs(predictionDiff);
    if (absDiff > 3) score += 20;
    else if (absDiff > 2) score += 15;
    else if (absDiff > 1) score += 10;
    else score += 5;
  }
  
  // Confidence component (0-10 points)
  if (confidence != null) {
    if (confidence > 80) score += 10;
    else if (confidence > 70) score += 8;
    else if (confidence > 60) score += 6;
    else score += 4;
  }
  
  // Convert score to letter grade
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D+';
  if (score >= 40) return 'D';
  if (score >= 35) return 'D-';
  return 'F';
}

/**
 * Get color for cover probability
 */
export function getCoverProbabilityColor(probability) {
  if (probability == null) return 'text-gray-400';
  if (probability > 60) return 'text-green-400';
  if (probability >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

/**
 * Get color for EV
 */
export function getEVColor(ev) {
  if (ev == null) return 'text-gray-400';
  if (ev > 0) return 'text-green-400';
  return 'text-red-400';
}

/**
 * Get color for bet rating
 */
export function getBetRatingColor(rating) {
  if (!rating) return 'text-gray-400';
  if (rating.startsWith('A')) return 'text-green-400';
  if (rating.startsWith('B')) return 'text-green-300';
  if (rating.startsWith('C')) return 'text-yellow-400';
  if (rating.startsWith('D')) return 'text-orange-400';
  return 'text-red-400';
}






