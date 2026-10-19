#!/usr/bin/env node
/**
 * Fetch team box-score rows from ESPN into backend/data/team_game_stats.json.
 *
 *   node backend/scripts/refreshTeamGameStats.mjs [season ...]
 *
 * Seasons as "2025-26"; default is the current season. Only games not already
 * on file are fetched, so re-running is cheap.
 */
import { refreshTeamGameStats, seasonForDate } from '../services/teamContextService.js';

const seasons = process.argv.slice(2).length ? process.argv.slice(2) : [seasonForDate(new Date().toISOString())];
const added = await refreshTeamGameStats(seasons, { log: true });
console.log(`Added ${added} games`);
