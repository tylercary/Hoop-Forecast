#!/usr/bin/env node
/**
 * Fetch each tracked player's ESPN game log for the seasons in the prediction
 * export, so the edge-model trainer can reconstruct what the stored feature
 * vectors lack: the opponent, home flag and minutes of each game.
 *
 *   node backend/scripts/backfillGameLogs.mjs [--in backend/data/predictions_export_fv.json] [--out backend/data/backfill_gamelogs.json]
 *
 * Output: { players: { "<player name>": { espn_id, games: [{ d, e, o, h, min, pts, reb, ast, fg3m }] } } }
 * (d = date, e = ESPN event id, o = opponent, h = home). Both files are gitignored.
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { mapEspnToNbaAbbrev } from '../services/nbaApiService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const inp = opt('--in', path.join(__dirname, '../data/predictions_export_fv.json'));
const out = opt('--out', path.join(__dirname, '../data/backfill_gamelogs.json'));
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', Accept: 'application/json' };

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
const core = (s) => normalize(s).split(' ').filter(t => t && !SUFFIXES.has(t)).join(' ');

async function findEspnId(name) {
  const { data } = await axios.get('https://site.web.api.espn.com/apis/search/v2', { params: { query: name, limit: 10 }, headers: HEADERS, timeout: 15000 });
  const players = (data?.results || []).filter(r => r.type === 'player').flatMap(r => r.contents || [])
    .filter(c => c.sport === 'basketball' && /l:46~/.test(c.uid || ''));
  const target = core(name);
  const pick = players.find(c => core(c.displayName) === target) || players.find(c => core(c.displayName).includes(target)) || players[0];
  const m = /a:(\d+)/.exec(pick?.uid || '');
  return m ? m[1] : null;
}

async function fetchGames(espnId, seasonYear) {
  const { data } = await axios.get(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnId}/gamelog`,
    { params: { season: seasonYear }, headers: HEADERS, timeout: 15000 });
  const events = data?.events || {};
  const games = [];
  for (const st of data?.seasonTypes || []) {
    if ((st.displayName || '').toLowerCase().includes('preseason')) continue;
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const meta = events[ev.eventId];
        const stats = ev.stats || [];
        if (!meta || stats.length < 14) continue;
        const fg3 = String(stats[3] || '0-0').split('-').map(Number);
        games.push({
          d: (meta.gameDate || '').slice(0, 10), e: String(ev.eventId),
          o: mapEspnToNbaAbbrev(meta.opponent?.abbreviation) || null, h: meta.atVs === 'vs' ? 1 : 0,
          min: parseFloat(stats[0]) || 0, pts: parseInt(stats[13]) || 0, reb: parseInt(stats[7]) || 0,
          ast: parseInt(stats[8]) || 0, fg3m: fg3[0] || 0
        });
      }
    }
  }
  return games;
}

const preds = JSON.parse(fs.readFileSync(inp, 'utf8')).predictions;
const seasonYears = new Set();
for (const p of preds) {
  const [y, m] = (p.next_game?.date || p.created_at || '').slice(0, 10).split('-').map(Number);
  if (y) seasonYears.add(m >= 10 ? y + 1 : y);
}
const names = [...new Set(preds.map(p => p.player_name))];
const result = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { players: {} };
console.log(`${names.length} players, ESPN seasons ${[...seasonYears].join(', ')}`);

let done = 0;
const queue = names.filter(n => !result.players[n]?.games?.length);
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    try {
      const espnId = await findEspnId(name);
      if (!espnId) { result.players[name] = { espn_id: null, games: [] }; continue; }
      const games = [];
      const seen = new Set();
      for (const year of seasonYears) {
        for (const g of await fetchGames(espnId, year)) {
          if (g.d && !seen.has(g.d)) { seen.add(g.d); games.push(g); }
        }
      }
      games.sort((a, b) => a.d.localeCompare(b.d));
      result.players[name] = { espn_id: espnId, games };
    } catch (err) {
      console.warn(`\n${name}: ${err.message}`);
    }
    done++;
    if (done % 10 === 0) {
      process.stdout.write(`\r${done}/${names.length}`);
      fs.writeFileSync(out, JSON.stringify(result));
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(out, JSON.stringify(result));
const missing = names.filter(n => !result.players[n]?.games?.length);
console.log(`\nWrote ${out}; ${names.length - missing.length} players with games, ${missing.length} missing${missing.length ? ': ' + missing.slice(0, 20).join(', ') : ''}`);
