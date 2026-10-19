/**
 * Market price summary for one player prop: what the books say about the
 * line beyond the line itself. Stored on every tracked prediction (record
 * field `market`) and turned into edge-model features by
 * mlPredictionService.buildEdgeRow / edge_features.market_features.
 */

import { DFS_BOOKMAKERS } from './oddsEventCache.js';

/** American odds -> implied probability (with vig). */
export function americanToProb(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

/** Implied probability -> American odds (rounded). */
export function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return Math.round(p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Summarize the books behind one prop.
 * @param {object} propData  oddsService prop ({ line, over_odds, under_odds, bookmaker_key, all_bookmakers })
 * @returns {object|null} { line, over_odds, under_odds, over_prob_novig, n_books_priced,
 *                          line_min, line_max, line_spread, line_mean, n_books, pinnacle_line, bookmaker_key }
 */
export function summarizeMarket(propData) {
  if (!propData || !(propData.line > 0)) return null;
  const books = (propData.all_bookmakers || []).filter(b => b && b.line > 0);
  if (!books.length) books.push(propData);
  return summarizeBooks(books, propData.line, propData.bookmaker_key || null);
}

/**
 * Same from a flat list of books: [{ bookmaker_key, line, over_odds, under_odds }].
 * @param {Array} books
 * @param {number} line         the line being predicted
 * @param {string|null} bookmakerKey  the book that line came from
 */
export function summarizeBooks(books, line, bookmakerKey = null) {
  const all = (books || []).filter(b => b && Number(b.line) > 0);
  if (!all.length || !(line > 0)) return null;
  // Books post alternate lines too; keep each book's main line, the one it
  // prices closest to even (ties and unpriced lines: the first listed)
  const mainByBook = new Map();
  const offEven = (b) => {
    const po = americanToProb(b.over_odds);
    const pu = americanToProb(b.under_odds);
    return po == null || pu == null ? 1 : Math.abs(po - 0.5) + Math.abs(pu - 0.5);
  };
  for (const b of all) {
    const key = b.bookmaker_key || b.bookmaker || '?';
    const cur = mainByBook.get(key);
    if (!cur || offEven(b) < offEven(cur)) mainByBook.set(key, b);
  }
  const valid = [...mainByBook.values()];
  // Pick'em sites post fixed symmetric prices, so only sportsbooks price the line
  const priced = valid.filter(b => !DFS_BOOKMAKERS.has(b.bookmaker_key) &&
    Math.abs(Number(b.line) - line) < 0.01 && americanToProb(b.over_odds) != null && americanToProb(b.under_odds) != null);
  const overProbs = priced.map(b => americanToProb(b.over_odds));
  const underProbs = priced.map(b => americanToProb(b.under_odds));
  const po = mean(overProbs);
  const pu = mean(underProbs);
  const lines = valid.map(b => Number(b.line));
  const pinnacle = valid.find(b => b.bookmaker_key === 'pinnacle');
  return {
    line,
    bookmaker_key: bookmakerKey,
    over_odds: po != null ? probToAmerican(po) : null,
    under_odds: pu != null ? probToAmerican(pu) : null,
    over_prob_novig: po != null && pu != null && po + pu > 0 ? Math.round(po / (po + pu) * 10000) / 10000 : null,
    n_books_priced: priced.length,
    line_min: Math.min(...lines),
    line_max: Math.max(...lines),
    line_spread: Math.round((Math.max(...lines) - Math.min(...lines)) * 100) / 100,
    line_mean: Math.round(mean(lines) * 1000) / 1000,
    n_books: valid.length,
    pinnacle_line: pinnacle ? Number(pinnacle.line) : null
  };
}
