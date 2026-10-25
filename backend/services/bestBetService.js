/**
 * Best available bet across books for one prop.
 *
 * The edge model predicts actual - line, so it can be scored at every line
 * the books post, not just the consensus. This module turns those residuals
 * into a per-(book, line, side) table of model probability, de-vigged
 * implied probability, EV per $1 and the edge in probability points, and
 * picks the best bet by EV among sides that clear the -110 break-even and
 * have positive EV at the book's price.
 *
 * DFS books (symmetric fixed prices) are scored so the odds table can show
 * the model's number for their line, but they only qualify as the best bet
 * when no sportsbook posts a line.
 */

import { overProbabilityFromMap } from '../ml/probabilityMap.js';
import { createHash } from 'crypto';
import { DFS_BOOKMAKERS } from './oddsEventCache.js';
import { americanToProb, mainLinePerBook } from './marketFeatureService.js';

/** Minimum model probability for a side to count as a bet (break-even at -110). */
export const BREAK_EVEN_PROBABILITY = 0.524;

const round = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * One entry per book, at the book's main line: [{ bookmaker, bookmaker_key,
 * line, over_odds, under_odds }]. Alternate-line ladders are left out because
 * the feed fills their unpriced side with -110, which would read as value.
 */
function usableBooks(propData) {
  return mainLinePerBook(propData?.all_bookmakers || []);
}

/**
 * Every distinct line to score for a prop: each book's main line plus the
 * consensus line, ascending.
 * @returns {number[]}
 */
export function distinctLines(propData) {
  const lines = new Set();
  if (Number(propData?.line) > 0) lines.add(Number(propData.line));
  for (const b of usableBooks(propData)) lines.add(Number(b.line));
  return [...lines].sort((a, b) => a - b);
}

/** Short stable hash of the lines a prop was scored at (for cache keys). */
export function linesHash(lines) {
  return createHash('md5').update((lines || []).map(l => Number(l).toFixed(1)).join(',')).digest('hex').slice(0, 8);
}

/** P(over) from the fitted probability map, as a fraction in [0.05, 0.95]. */
export function overProbabilityAt(probabilityMap, residual, line) {
  const p = overProbabilityFromMap(probabilityMap, residual, line);
  return p == null ? null : p / 100;
}

/** Expected profit per $1 staked at American odds for a side with probability p. */
export function expectedValue(p, odds) {
  const o = Number(odds);
  if (!(p >= 0 && p <= 1) || !Number.isFinite(o) || o === 0) return null;
  const payout = o > 0 ? o / 100 : 100 / -o;
  return p * payout - (1 - p);
}

/**
 * Implied probability of a side; de-vigged against the other side's price
 * when both exist, raw (with vig) otherwise.
 */
export function impliedProbability(sideOdds, otherOdds) {
  const ps = americanToProb(sideOdds);
  if (ps == null) return null;
  const po = americanToProb(otherOdds);
  return po != null && ps + po > 0 ? ps / (ps + po) : ps;
}

/**
 * Score every (book, line, side) and choose the best bet.
 * @param {object} propData        odds prop ({ line, all_bookmakers, ... })
 * @param {object} residualByLine  { [line]: residual } from the edge model
 * @param {object} probabilityMap  edge metadata probability_map
 * @returns {{ best_bet: object|null, book_edges: object[] }}
 */
export function scoreBookEdges(propData, residualByLine, probabilityMap) {
  const books = usableBooks(propData);
  if (!books.length || !residualByLine || !probabilityMap) return { best_bet: null, book_edges: [] };

  const hasSportsbook = books.some(b => !DFS_BOOKMAKERS.has(b.bookmaker_key));
  const edges = [];
  for (const b of books) {
    const line = Number(b.line);
    const residual = residualByLine[line] ?? residualByLine[line.toFixed(1)];
    const pOver = overProbabilityAt(probabilityMap, residual, line);
    if (pOver == null) continue;
    const dfs = DFS_BOOKMAKERS.has(b.bookmaker_key);
    for (const side of ['over', 'under']) {
      const odds = side === 'over' ? b.over_odds : b.under_odds;
      const other = side === 'over' ? b.under_odds : b.over_odds;
      if (odds == null) continue;
      const model = side === 'over' ? pOver : 1 - pOver;
      const implied = impliedProbability(odds, other);
      const ev = expectedValue(model, odds);
      if (ev == null) continue;
      edges.push({
        bookmaker: b.bookmaker || b.bookmaker_key,
        bookmaker_key: b.bookmaker_key || null,
        line,
        side,
        odds: Number(odds),
        model_probability: round(model, 4),
        implied_probability: round(implied, 4),
        ev: round(ev, 4),
        edge_points: implied != null ? round((model - implied) * 100, 1) : null,
        dfs
      });
    }
  }

  const eligible = edges.filter(e => e.model_probability >= BREAK_EVEN_PROBABILITY && e.ev > 0 && (!e.dfs || !hasSportsbook));
  let best = null;
  for (const e of eligible) {
    if (!best || e.ev > best.ev || (e.ev === best.ev && e.model_probability > best.model_probability)) best = e;
  }
  return {
    best_bet: best ? { ...best } : null,
    book_edges: edges
  };
}
