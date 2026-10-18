/**
 * Utility functions for calculating trending props based on sportsbook activity
 */

/**
 * Get the count of sportsbooks offering a specific prop
 * @param {Object} propData - Object where keys are sportsbook names
 * @returns {number} - Count of sportsbooks
 */
export function getPropBookCount(propData) {
  if (!propData || typeof propData !== 'object') return 0;
  return Object.keys(propData).length;
}

/**
 * Find the best odds (highest return) from all sportsbooks for a prop
 * @param {Object} propData - Object with sportsbook data
 * @returns {Object|null} - { sportsbook, odds, type } or null
 */
export function findBestOdds(propData) {
  if (!propData || typeof propData !== 'object') return null;

  let bestOdds = null;
  let bestValue = -Infinity;

  for (const [sportsbook, data] of Object.entries(propData)) {
    // Check over odds
    if (data.over && data.over.odds) {
      const overValue = parseOddsValue(data.over.odds);
      if (overValue > bestValue) {
        bestValue = overValue;
        bestOdds = {
          sportsbook,
          odds: data.over.odds,
          type: 'over'
        };
      }
    }

    // Check under odds
    if (data.under && data.under.odds) {
      const underValue = parseOddsValue(data.under.odds);
      if (underValue > bestValue) {
        bestValue = underValue;
        bestOdds = {
          sportsbook,
          odds: data.under.odds,
          type: 'under'
        };
      }
    }
  }

  return bestOdds;
}

/**
 * Parse American odds to comparable value (higher = better return)
 * @param {number} odds - American odds (e.g., -110, +150)
 * @returns {number} - Comparable value
 */
function parseOddsValue(odds) {
  if (typeof odds !== 'number') return -Infinity;
  
  if (odds > 0) {
    // Positive odds: higher is better (e.g., +150 better than +110)
    return odds;
  } else {
    // Negative odds: closer to 0 is better (e.g., -105 better than -150)
    // Convert to positive scale where higher is better
    return 1000 + odds; // -105 → 895, -150 → 850
  }
}

/**
 * Get list of sportsbooks offering a prop
 * @param {Object} propData - Object where keys are sportsbook names
 * @returns {Array<string>} - Array of sportsbook names
 */
export function getPropSportsbooks(propData) {
  if (!propData || typeof propData !== 'object') return [];
  return Object.keys(propData);
}

/**
 * Sort trending props by book count (descending)
 * @param {Array} props - Array of prop objects
 * @returns {Array} - Sorted array
 */
export function sortByBookCount(props) {
  return props.sort((a, b) => {
    // Primary sort: book count (descending)
    if (b.bookCount !== a.bookCount) {
      return b.bookCount - a.bookCount;
    }
    // Secondary sort: line value (descending) for stability
    return b.line - a.line;
  });
}

/**
 * Format prop type for display
 * @param {string} propType - Internal prop type (e.g., 'points', 'pra')
 * @returns {string} - Display label (e.g., 'PTS', 'PTS+REB+AST')
 */
export function formatPropType(propType) {
  const labels = {
    'points': 'PTS',
    'rebounds': 'REB',
    'assists': 'AST',
    'threes': '3PT',
    'pra': 'PTS+REB+AST',
    'pr': 'PTS+REB',
    'pa': 'PTS+AST',
    'ra': 'REB+AST',
    'steals': 'STL',
    'blocks': 'BLK'
  };
  return labels[propType] || propType.toUpperCase();
}


/**
 * Convert American odds to implied probability (e.g. -110 -> 0.524)
 */
function impliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (!odds) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/**
 * Market lean: the no-vig probability of the OVER, averaged across books
 * that list both sides. Returns a whole-number percent (e.g. 54), or null.
 */
export function getMarketOverPct(propData) {
  if (!propData || typeof propData !== 'object') return null;

  const overShares = [];
  for (const data of Object.values(propData)) {
    const over = impliedProbability(data.over?.odds);
    const under = impliedProbability(data.under?.odds);
    if (over && under) overShares.push(over / (over + under));
  }

  if (overShares.length === 0) return null;
  const average = overShares.reduce((sum, share) => sum + share, 0) / overShares.length;
  return Math.round(average * 100);
}
