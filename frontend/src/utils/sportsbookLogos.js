/**
 * Centralized Sportsbook Logo Mapping
 * 
 * This utility provides a single source of truth for all sportsbook logos.
 * It handles name normalization and provides fallback support.
 */

// Icon logos (small square) - used for Best Odds overlays, etc.
// Keys are normalized (lowercase, no spaces/underscores/special chars)
const SPORTSBOOK_ICON_MAP = {
  // Major US Sportsbooks
  'draftkings': '/images/sportsbooks/icons/draftkings.png',
  'fanduel': '/images/sportsbooks/icons/fanduel.png',
  'betmgm': '/images/sportsbooks/icons/betmgm.png',
  'caesars': '/images/sportsbooks/icons/caesars.png',
  'bet365': '/images/sportsbooks/icons/bet365.png',

  // Additional US Books
  'bovada': '/images/sportsbooks/icons/bovada.png',
  'betrivers': '/images/sportsbooks/icons/betrivers.png',
  'betonlineag': '/images/sportsbooks/icons/betonline.png',
  'betonline': '/images/sportsbooks/icons/betonline.png',
  'williamhillus': '/images/sportsbooks/icons/williamhill.png',
  'williamhill': '/images/sportsbooks/icons/williamhill.png',
  'pointsbet': '/images/sportsbooks/icons/pointsbet.png',
  'superbook': '/images/sportsbooks/icons/superbook.png',
  'barstool': '/images/sportsbooks/icons/barstool.png',
  'unibet': '/images/sportsbooks/icons/unibet.png',
  'wynnbet': '/images/sportsbooks/icons/wynnbet.png',
  'twinspires': '/images/sportsbooks/icons/twinspires.png',

  // New Entrants
  'hardrock': '/images/sportsbooks/icons/hardrock.png',
  'hardrockbet': '/images/sportsbooks/icons/hardrock.png',
  'espnbet': '/images/sportsbooks/icons/espnbet.png',
  'fanatics': '/images/sportsbooks/icons/fanatics.png',

  // DFS/Props-Focused
  'prizepicks': '/images/sportsbooks/icons/prizepicks.png',
  'underdog': '/images/sportsbooks/icons/underdog.png',
  'underdogfantasy': '/images/sportsbooks/icons/underdog.png',
  'parlayplay': '/images/sportsbooks/icons/parlayplay.png',
  'sleeper': '/images/sportsbooks/icons/sleeper.png',

  // International
  'pinnacle': '/images/sportsbooks/icons/pinnacle.png',
  'betway': '/images/sportsbooks/icons/betway.png',
  'mybookieag': '/images/sportsbooks/icons/mybookie.png',
  'mybookie': '/images/sportsbooks/icons/mybookie.png',
  'lowvig': '/images/sportsbooks/icons/lowvig.png',
  'betano': '/images/sportsbooks/icons/betano.png',
  'bwin': '/images/sportsbooks/icons/bwin.png',

  // Calculated/Consensus
  'calculated': '/images/sportsbooks/icons/consensus.png',
  'consensus': '/images/sportsbooks/icons/consensus.png',
  'average': '/images/sportsbooks/icons/consensus.png'
};

// Banner logos (wide horizontal) - used for column headers
const SPORTSBOOK_BANNER_MAP = {
  // Major US Sportsbooks
  'draftkings': '/images/sportsbooks/banners/draftkings.png',
  'fanduel': '/images/sportsbooks/banners/fanduel.png',
  'betmgm': '/images/sportsbooks/banners/betmgm.png',
  'caesars': '/images/sportsbooks/banners/caesars.png',
  'bet365': '/images/sportsbooks/banners/bet365.png',

  // Additional US Books
  'bovada': '/images/sportsbooks/banners/bovada.png',
  'betrivers': '/images/sportsbooks/banners/betrivers.png',
  'betonlineag': '/images/sportsbooks/banners/betonline.png',
  'betonline': '/images/sportsbooks/banners/betonline.png',
  'williamhillus': '/images/sportsbooks/banners/williamhill.png',
  'williamhill': '/images/sportsbooks/banners/williamhill.png',
  'pointsbet': '/images/sportsbooks/banners/pointsbet.png',
  'superbook': '/images/sportsbooks/banners/superbook.png',
  'barstool': '/images/sportsbooks/banners/barstool.png',
  'unibet': '/images/sportsbooks/banners/unibet.png',
  'wynnbet': '/images/sportsbooks/banners/wynnbet.png',
  'twinspires': '/images/sportsbooks/banners/twinspires.png',

  // New Entrants
  'hardrock': '/images/sportsbooks/banners/hardrock.png',
  'hardrockbet': '/images/sportsbooks/banners/hardrock.png',
  'espnbet': '/images/sportsbooks/banners/espnbet.png',
  'fanatics': '/images/sportsbooks/banners/fanatics.png',

  // DFS/Props-Focused
  'prizepicks': '/images/sportsbooks/banners/prizepicks.png',
  'underdog': '/images/sportsbooks/banners/underdog.png',
  'underdogfantasy': '/images/sportsbooks/banners/underdog.png',
  'parlayplay': '/images/sportsbooks/banners/parlayplay.png',
  'sleeper': '/images/sportsbooks/banners/sleeper.png',

  // International
  'pinnacle': '/images/sportsbooks/banners/pinnacle.png',
  'betway': '/images/sportsbooks/banners/betway.png',
  'mybookieag': '/images/sportsbooks/banners/mybookie.png',
  'mybookie': '/images/sportsbooks/banners/mybookie.png',
  'lowvig': '/images/sportsbooks/banners/lowvig.png',
  'betano': '/images/sportsbooks/banners/betano.png',
  'bwin': '/images/sportsbooks/banners/bwin.png',

  // Calculated/Consensus
  'calculated': '/images/sportsbooks/banners/consensus.png',
  'consensus': '/images/sportsbooks/banners/consensus.png',
  'average': '/images/sportsbooks/banners/consensus.png'
};

// Banner background colors for sportsbooks with transparent banners
// Only needed when the banner PNG doesn't have its own solid background
const SPORTSBOOK_BANNER_BG = {
  'betonlineag': '#ffffff',
  'betonline': '#ffffff',
  'betmgm': '#1a1a2e',
  'williamhillus': '#00205b',
  'williamhill': '#00205b',
};

// Display names mapping (for consistency)
const SPORTSBOOK_DISPLAY_NAMES = {
  'draftkings': 'DraftKings',
  'fanduel': 'FanDuel',
  'betmgm': 'BetMGM',
  'caesars': 'Caesars',
  'bet365': 'Bet365',
  'bovada': 'Bovada',
  'betrivers': 'BetRivers',
  'betonlineag': 'BetOnline',
  'betonline': 'BetOnline',
  'williamhillus': 'William Hill',
  'williamhill': 'William Hill',
  'pointsbet': 'PointsBet',
  'superbook': 'SuperBook',
  'barstool': 'Barstool',
  'unibet': 'Unibet',
  'wynnbet': 'WynnBet',
  'twinspires': 'TwinSpires',
  'hardrock': 'Hard Rock',
  'hardrockbet': 'Hard Rock',
  'espnbet': 'ESPN BET',
  'fanatics': 'Fanatics',
  'prizepicks': 'PrizePicks',
  'underdog': 'Underdog',
  'underdogfantasy': 'Underdog',
  'parlayplay': 'ParlayPlay',
  'sleeper': 'Sleeper',
  'pinnacle': 'Pinnacle',
  'betway': 'Betway',
  'mybookieag': 'MyBookie',
  'mybookie': 'MyBookie',
  'lowvig': 'LowVig',
  'betano': 'Betano',
  'bwin': 'Bwin',
  'calculated': 'Consensus',
  'consensus': 'Consensus',
  'average': 'Average'
};

// Default fallback logos
const DEFAULT_ICON = '/images/sportsbooks/icons/default.png';
const DEFAULT_BANNER = '/images/sportsbooks/banners/default.png';

/**
 * Normalize sportsbook name for lookup
 * Removes spaces, underscores, dots, and converts to lowercase
 * 
 * @param {string} name - Raw sportsbook name from API
 * @returns {string} Normalized key
 */
export function normalizeSportsbookName(name) {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .toLowerCase()
    .replace(/\s+/g, '')           // Remove all spaces
    .replace(/_/g, '')             // Remove underscores
    .replace(/\./g, '')            // Remove dots
    .replace(/-/g, '')             // Remove hyphens
    .replace(/'/g, '')             // Remove apostrophes
    .trim();
}

/**
 * Get sportsbook icon logo path (small square)
 *
 * @param {string} sportsbookName - Sportsbook name (any format)
 * @returns {string} Icon logo image path
 */
export function getSportsbookLogo(sportsbookName) {
  if (!sportsbookName) return DEFAULT_ICON;

  const normalized = normalizeSportsbookName(sportsbookName);

  // Direct match
  if (SPORTSBOOK_ICON_MAP[normalized]) {
    return SPORTSBOOK_ICON_MAP[normalized];
  }

  // Partial match (for variants)
  for (const [key, logo] of Object.entries(SPORTSBOOK_ICON_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return logo;
    }
  }

  // Fallback to default
  console.warn(`No icon found for sportsbook: "${sportsbookName}" (normalized: "${normalized}")`);
  return DEFAULT_ICON;
}

/**
 * Get sportsbook banner logo path (wide horizontal)
 *
 * @param {string} sportsbookName - Sportsbook name (any format)
 * @returns {string} Banner logo image path
 */
export function getSportsbookBanner(sportsbookName) {
  if (!sportsbookName) return DEFAULT_BANNER;

  const normalized = normalizeSportsbookName(sportsbookName);

  // Direct match
  if (SPORTSBOOK_BANNER_MAP[normalized]) {
    return SPORTSBOOK_BANNER_MAP[normalized];
  }

  // Partial match (for variants)
  for (const [key, banner] of Object.entries(SPORTSBOOK_BANNER_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return banner;
    }
  }

  // Fallback to default
  console.warn(`No banner found for sportsbook: "${sportsbookName}" (normalized: "${normalized}")`);
  return DEFAULT_BANNER;
}

/**
 * Get banner background color (for transparent banners)
 *
 * @param {string} sportsbookName - Sportsbook name (any format)
 * @returns {string|null} Background color hex or null
 */
export function getSportsbookBannerBg(sportsbookName) {
  if (!sportsbookName) return null;
  const normalized = normalizeSportsbookName(sportsbookName);
  if (SPORTSBOOK_BANNER_BG[normalized]) return SPORTSBOOK_BANNER_BG[normalized];
  for (const [key, bg] of Object.entries(SPORTSBOOK_BANNER_BG)) {
    if (normalized.includes(key) || key.includes(normalized)) return bg;
  }
  return null;
}

/**
 * Get sportsbook display name
 * 
 * @param {string} sportsbookName - Sportsbook name (any format)
 * @returns {string} Formatted display name
 */
export function getSportsbookDisplayName(sportsbookName) {
  if (!sportsbookName) return 'Unknown';
  
  const normalized = normalizeSportsbookName(sportsbookName);
  
  // Direct match
  if (SPORTSBOOK_DISPLAY_NAMES[normalized]) {
    return SPORTSBOOK_DISPLAY_NAMES[normalized];
  }
  
  // Partial match
  for (const [key, displayName] of Object.entries(SPORTSBOOK_DISPLAY_NAMES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return displayName;
    }
  }
  
  // Fallback to capitalize first letter of each word
  return sportsbookName
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get complete sportsbook info (icon + banner + display name)
 *
 * @param {string} sportsbookName - Sportsbook name (any format)
 * @returns {object} { icon: string, banner: string, displayName: string, normalized: string }
 */
export function getSportsbookInfo(sportsbookName) {
  return {
    icon: getSportsbookLogo(sportsbookName),
    banner: getSportsbookBanner(sportsbookName),
    logo: getSportsbookLogo(sportsbookName),
    displayName: getSportsbookDisplayName(sportsbookName),
    normalized: normalizeSportsbookName(sportsbookName)
  };
}

/**
 * Get list of all supported sportsbooks (for debugging)
 * 
 * @returns {Array<string>} List of all sportsbook keys
 */
export function getAllSupportedSportsbooks() {
  return Object.keys(SPORTSBOOK_ICON_MAP).sort();
}

/**
 * Check if logo exists for a sportsbook
 * 
 * @param {string} sportsbookName - Sportsbook name
 * @returns {boolean} True if logo mapping exists
 */
export function hasLogoMapping(sportsbookName) {
  const normalized = normalizeSportsbookName(sportsbookName);
  return SPORTSBOOK_ICON_MAP.hasOwnProperty(normalized);
}

