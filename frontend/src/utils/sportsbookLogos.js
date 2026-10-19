/**
 * Sportsbook branding: one table of icon, display name and brand color per
 * book. Keys are normalized names (lowercase, no spaces/underscores/dots), so
 * both The Odds API keys ("williamhill_us") and titles ("theScore Bet") match.
 *
 * Icons live in /images/sportsbooks/icons/ as 256px PNGs pulled from each
 * book's own site or official app listing.
 */

const ICONS = '/images/sportsbooks/icons';

const BOOKS = {
  draftkings:      { name: 'DraftKings',   icon: `${ICONS}/draftkings.png`,  bg: '#111518' },
  fanduel:         { name: 'FanDuel',      icon: `${ICONS}/fanduel.png`,     bg: '#1493ff' },
  betmgm:          { name: 'BetMGM',       icon: `${ICONS}/betmgm.png`,      bg: '#1a1a2e' },
  caesars:         { name: 'Caesars',      icon: `${ICONS}/caesars.png`,     bg: '#043b2c' },
  betrivers:       { name: 'BetRivers',    icon: `${ICONS}/betrivers.png`,   bg: '#0a2e5c' },
  fanatics:        { name: 'Fanatics',     icon: `${ICONS}/fanatics.png`,    bg: '#0a1f44' },
  thescorebet:     { name: 'theScore Bet', icon: `${ICONS}/thescorebet.png`, bg: '#0a3ea8' },
  hardrockbet:     { name: 'Hard Rock Bet', icon: `${ICONS}/hardrockbet.png`, bg: '#5b32d6' },
  betparx:         { name: 'betPARX',      icon: `${ICONS}/betparx.png`,     bg: '#102a57' },
  ballybet:        { name: 'Bally Bet',    icon: `${ICONS}/ballybet.png`,    bg: '#b3101f' },
  bovada:          { name: 'Bovada',       icon: `${ICONS}/bovada.png`,      bg: '#c41a1a' },
  betonlineag:     { name: 'BetOnline',    icon: `${ICONS}/betonline.png`,   bg: '#1e293b' },
  prizepicks:      { name: 'PrizePicks',   icon: `${ICONS}/prizepicks.png`,  bg: '#3d1a8f' },
  underdog:        { name: 'Underdog',     icon: `${ICONS}/underdog.png`,    bg: '#f5c33b' },
  pick6:           { name: 'DK Pick6',     icon: `${ICONS}/draftkings.png`,  bg: '#111518' },
  pinnacle:        { name: 'Pinnacle',     icon: `${ICONS}/pinnacle.png`,    bg: '#0b1223' },
};

// Other spellings The Odds API or older data may use
const ALIASES = {
  williamhillus: 'caesars',
  williamhill: 'caesars',
  caesarssportsbook: 'caesars',
  espnbet: 'thescorebet',
  hardrock: 'hardrockbet',
  betonline: 'betonlineag',
  underdogfantasy: 'underdog',
  draftkingspick6: 'pick6',
  dkpick6: 'pick6',
  draftkingssportsbook: 'draftkings',
  fanduelsportsbook: 'fanduel',
};

export function normalizeSportsbookName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[\s_.\-']/g, '').trim();
}

function lookup(sportsbookName) {
  const key = normalizeSportsbookName(sportsbookName);
  if (!key) return null;
  const resolved = ALIASES[key] || key;
  if (BOOKS[resolved]) return BOOKS[resolved];
  // Partial match for variants like "fanduel_us"
  const match = Object.keys(BOOKS).find(k => resolved.includes(k) || k.includes(resolved));
  return match ? BOOKS[match] : null;
}

// Readable text color for a given background
export function textColorFor(bg) {
  const hex = (bg || '').replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#0f172a' : '#ffffff';
}

/** Icon path, or null when the book has no icon. */
export function getSportsbookLogo(sportsbookName) {
  return lookup(sportsbookName)?.icon || null;
}

/** Wide banner images are no longer used; headers render icon + name instead. */
export function getSportsbookBanner() {
  return null;
}

/** Brand background color for a book's header, or null. */
export function getSportsbookBannerBg(sportsbookName) {
  return lookup(sportsbookName)?.bg || null;
}

/** Display name, falling back to a tidied version of what the API sent. */
export function getSportsbookDisplayName(sportsbookName) {
  const book = lookup(sportsbookName);
  if (book) return book.name;
  if (!sportsbookName) return 'Unknown';
  return String(sportsbookName).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getSportsbookInfo(sportsbookName) {
  const book = lookup(sportsbookName);
  return {
    icon: book?.icon || null,
    logo: book?.icon || null,
    banner: null,
    bannerBg: book?.bg || null,
    displayName: getSportsbookDisplayName(sportsbookName),
    normalized: normalizeSportsbookName(sportsbookName),
  };
}

export function getAllSupportedSportsbooks() {
  return Object.keys(BOOKS).sort();
}

export function hasLogoMapping(sportsbookName) {
  return lookup(sportsbookName) !== null;
}
