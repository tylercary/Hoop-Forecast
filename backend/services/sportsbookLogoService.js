/**
 * Sportsbook Logo Service
 * Provides URLs and display names for sportsbook logos
 */

// Sportsbook key to logo URL mapping
// Using publicly available logos or placeholder URLs
const SPORTSBOOK_LOGOS = {
  'draftkings': {
    name: 'DraftKings',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/DraftKings-Logo.png',
    displayName: 'DraftKings Sportsbook'
  },
  'fanduel': {
    name: 'FanDuel',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/FanDuel-Logo.png',
    displayName: 'FanDuel Sportsbook'
  },
  'betmgm': {
    name: 'BetMGM',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/BetMGM-Logo.png',
    displayName: 'BetMGM'
  },
  'caesars': {
    name: 'Caesars',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/Caesars-Sportsbook-Logo.png',
    displayName: 'Caesars Sportsbook'
  },
  'pointsbet': {
    name: 'PointsBet',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/PointsBet-Logo.png',
    displayName: 'PointsBet'
  },
  'barstool': {
    name: 'Barstool',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/Barstool-Sportsbook-Logo.png',
    displayName: 'Barstool Sportsbook'
  },
  'betrivers': {
    name: 'BetRivers',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/BetRivers-Logo.png',
    displayName: 'BetRivers'
  },
  'wynnbet': {
    name: 'WynnBet',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/WynnBet-Logo.png',
    displayName: 'WynnBet'
  },
  'unibet': {
    name: 'Unibet',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/Unibet-Logo.png',
    displayName: 'Unibet'
  },
  'foxbet': {
    name: 'FoxBet',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/FoxBet-Logo.png',
    displayName: 'FoxBet'
  },
  'hardrock': {
    name: 'Hard Rock',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/Hard-Rock-Bet-Logo.png',
    displayName: 'Hard Rock BET'
  },
  'espnbet': {
    name: 'ESPN BET',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/ESPN-BET-Logo.png',
    displayName: 'ESPN BET'
  },
  'prizepicks': {
    name: 'PrizePicks',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/PrizePicks-Logo.png',
    displayName: 'PrizePicks'
  },
  'underdog': {
    name: 'Underdog',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/Underdog-Logo.png',
    displayName: 'Underdog'
  },
  'sugarhouse': {
    name: 'SugarHouse',
    logo: 'https://logos-world.net/wp-content/uploads/2021/02/SugarHouse-Logo.png',
    displayName: 'SugarHouse'
  }
};

/**
 * Get sportsbook info from key or name
 */
export function getSportsbookInfo(bookmakerKeyOrName) {
  if (!bookmakerKeyOrName) return null;
  
  const key = bookmakerKeyOrName.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  
  // Try exact match first
  if (SPORTSBOOK_LOGOS[key]) {
    return SPORTSBOOK_LOGOS[key];
  }
  
  // Try partial match
  for (const [sportsbookKey, info] of Object.entries(SPORTSBOOK_LOGOS)) {
    if (key.includes(sportsbookKey) || sportsbookKey.includes(key)) {
      return info;
    }
  }
  
  // Try matching by name
  for (const [sportsbookKey, info] of Object.entries(SPORTSBOOK_LOGOS)) {
    if (info.name.toLowerCase().includes(key) || key.includes(info.name.toLowerCase())) {
      return info;
    }
  }
  
  // Default fallback
  return {
    name: bookmakerKeyOrName,
    logo: null,
    displayName: bookmakerKeyOrName
  };
}

/**
 * Get sportsbook logo URL
 */
export function getSportsbookLogo(bookmakerKeyOrName) {
  const info = getSportsbookInfo(bookmakerKeyOrName);
  return info?.logo || null;
}

/**
 * Get sportsbook display name
 */
export function getSportsbookDisplayName(bookmakerKeyOrName) {
  const info = getSportsbookInfo(bookmakerKeyOrName);
  return info?.displayName || bookmakerKeyOrName;
}






