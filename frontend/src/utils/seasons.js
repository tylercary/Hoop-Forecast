/**
 * NBA season helpers. Seasons start in October and end with the Finals in June,
 * so a game on "2026-03-07" belongs to the "2025-26" season.
 */

export function getSeasonForDate(dateStr) {
  const [year, month] = String(dateStr).split('-').map(Number);
  if (!year || !month) return null;
  const startYear = month >= 10 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

// Prefer the game's date over its season label, which older backend responses got wrong
export function getGameSeason(game) {
  return (game.date && getSeasonForDate(game.date)) || game.season || null;
}

// Seasons that appear in the given games, most recent first
export function getSeasonsInStats(stats) {
  const seasons = new Set();
  for (const game of stats || []) {
    const season = getGameSeason(game);
    if (season) seasons.add(season);
  }
  return [...seasons].sort().reverse();
}
