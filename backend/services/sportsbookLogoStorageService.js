import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create sportsbook logos directory if it doesn't exist
const LOGOS_DIR = path.join(__dirname, '../public/images/sportsbooks');

if (!fs.existsSync(LOGOS_DIR)) {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
}

/**
 * Normalize sportsbook name for filename
 */
function normalizeForFilename(name) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .trim();
}

/**
 * Get local logo path for a sportsbook
 */
export function getLocalLogoPath(sportsbookName) {
  const filename = `${normalizeForFilename(sportsbookName)}.png`;
  return path.join(LOGOS_DIR, filename);
}

/**
 * Get logo URL for frontend
 */
export function getLogoUrl(sportsbookName) {
  const filename = `${normalizeForFilename(sportsbookName)}.png`;
  return `/images/sportsbooks/${filename}`;
}

/**
 * Check if logo exists locally
 */
export function logoExists(sportsbookName) {
  const logoPath = getLocalLogoPath(sportsbookName);
  return fs.existsSync(logoPath);
}

/**
 * Sportsbook logo URLs - using reliable sources
 * These will be downloaded and stored locally
 */
const SPORTSBOOK_LOGO_URLS = {
  'draftkings': 'https://cdn.brandfolder.io/DRKTKQ9S/at/7jq8vq-8b8h5k-9x7q8v/DraftKings_Logo_White.png',
  'fanduel': 'https://www.fanduel.com/favicon-32x32.png',
  'betmgm': 'https://sports.betmgm.com/favicon-32x32.png',
  'caesars': 'https://www.caesars.com/favicon-32x32.png',
  'pointsbet': 'https://www.pointsbet.com/favicon-32x32.png',
  'barstool': 'https://www.barstoolsportsbook.com/favicon-32x32.png',
  'betrivers': 'https://www.betrivers.com/favicon-32x32.png',
  'wynnbet': 'https://www.wynnbet.com/favicon-32x32.png',
  'unibet': 'https://www.unibet.com/favicon-32x32.png',
  'foxbet': 'https://www.foxbet.com/favicon-32x32.png',
  'hardrock': 'https://www.hardrockbet.com/favicon-32x32.png',
  'espnbet': 'https://www.espnbet.com/favicon-32x32.png',
  'prizepicks': 'https://www.prizepicks.com/favicon-32x32.png',
  'underdog': 'https://www.underdog.com/favicon-32x32.png',
  'sugarhouse': 'https://www.sugarhouse.com/favicon-32x32.png'
};

/**
 * Download and save sportsbook logo
 * Tries multiple sources and formats
 */
export async function downloadSportsbookLogo(sportsbookName, logoUrl = null) {
  try {
    const normalizedName = normalizeForFilename(sportsbookName);
    const logoPath = getLocalLogoPath(sportsbookName);
    
    // Skip if logo already exists
    if (fs.existsSync(logoPath)) {
      return getLogoUrl(sportsbookName);
    }
    
    // Try to find logo URL
    let imageUrl = logoUrl;
    if (!imageUrl) {
      // Try to find in our mapping
      const key = normalizedName.toLowerCase();
      imageUrl = SPORTSBOOK_LOGO_URLS[key];
    }
    
    if (!imageUrl) {
      return null;
    }
    
    
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/png,image/jpeg,image/*,*/*'
        },
        validateStatus: (status) => status < 500
      });
      
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      // Save logo to disk
      fs.writeFileSync(logoPath, response.data);
      
      return getLogoUrl(sportsbookName);
    } catch (downloadError) {
      // If download fails, try alternative sources
      
      // Try favicon as fallback
      const domain = sportsbookName.toLowerCase().replace(/\s+/g, '').replace('sportsbook', '');
      const fallbackUrls = [
        `https://www.${domain}.com/favicon-32x32.png`,
        `https://www.${domain}.com/favicon.ico`,
        `https://${domain}.com/favicon-32x32.png`,
        `https://${domain}.com/favicon.ico`
      ];
      
      for (const fallbackUrl of fallbackUrls) {
        try {
          const response = await axios.get(fallbackUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            validateStatus: (status) => status < 500
          });
          
          if (response.status < 400) {
            fs.writeFileSync(logoPath, response.data);
            return getLogoUrl(sportsbookName);
          }
        } catch (e) {
          // Continue to next fallback
        }
      }
      
      throw downloadError;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Get sportsbook logo URL (local if exists, otherwise return null)
 */
export function getSportsbookLogoUrl(sportsbookName) {
  if (logoExists(sportsbookName)) {
    return getLogoUrl(sportsbookName);
  }
  return null;
}

