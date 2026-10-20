#!/usr/bin/env node
/**
 * Join the historical Odds API snapshots (backfillHistoricalOdds.mjs) onto the
 * archived prediction export: every record gains the pick-time `market`
 * summary (marketFeatureService.summarizeBooks at the stored betting line,
 * the shape live records store) and the `closing` snapshot
 * (closingLineService.buildClosing), plus a `backfill` block with the
 * snapshot timestamps and the reconstructed consensus line.
 *
 *   node backend/scripts/joinHistoricalOdds.mjs [--in FILE] [--odds-dir DIR] [--out FILE] [--batch-gap-minutes N]
 *
 * Records are matched to a game by date (the UTC day of tip-off, as the
 * archive stores it) and by the player's presence in the game's odds
 * (archived rows carry no team); names are normalised (accents,
 * punctuation, Jr/Sr/II/III suffixes). The pick-time snapshot is the batch
 * snapshot at or before the record's created_at (never after), capped at the
 * closing snapshot. Prints match rates per prop, how often the stored line
 * differs from the reconstructed consensus by more than 0.5, and the closing
 * line value of the old pipeline's picks (edgeGradingService).
 *
 * Output (default backend/data/predictions_export_fv_market.json, gitignored)
 * is a new file; the production store is never touched.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeBooks } from '../services/marketFeatureService.js';
import { indexEventBooks, buildClosing, consensusLine } from '../services/closingLineService.js';
import { gradeEdgePredictions } from '../services/edgeGradingService.js';
import { isoDate, batchTimes, snapshotTimeFor } from './backfillHistoricalOdds.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const DATA_DIR = path.join(__dirname, '../data');
const IN = opt('--in', path.join(DATA_DIR, 'predictions_export_fv.json'));
const ODDS_DIR = opt('--odds-dir', path.join(DATA_DIR, 'odds_history'));
const OUT = opt('--out', path.join(DATA_DIR, 'predictions_export_fv_market.json'));
const BATCH_GAP_MS = Number(opt('--batch-gap-minutes', 90)) * 60 * 1000;
const CLOSING_LEAD_MS = 5 * 60 * 1000;
const floor5 = (ms) => Math.floor(ms / 300000) * 300000;
const fileStamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
/** "Kevin Porter Jr." / "Luka Dončić" / "De'Aaron Fox" -> "kevin porter" / "luka doncic" / "deaaron fox" */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t && !SUFFIXES.has(t))
    .join(' ');
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Snapshot file -> { ts, index: Map("normName|prop" -> books) } (cached). */
const snapCache = new Map();
function loadSnapshot(eventId, ms) {
  const file = path.join(ODDS_DIR, `${eventId}_${fileStamp(ms)}.json`);
  if (snapCache.has(file)) return snapCache.get(file);
  const raw = readJson(file);
  let out = null;
  if (raw && raw.data && raw.data.bookmakers?.length) {
    const index = new Map();
    for (const [key, books] of indexEventBooks(raw.data)) {
      const i = key.lastIndexOf('|');
      const nk = `${normalizeName(key.slice(0, i))}|${key.slice(i + 1)}`;
      if (!index.has(nk)) index.set(nk, []);
      index.get(nk).push(...books);
    }
    out = { ts: raw.snapshot_timestamp || raw.requested_at, index };
  } else if (raw) {
    out = { ts: raw.snapshot_timestamp || raw.requested_at, index: new Map(), empty: true };
  }
  snapCache.set(file, out);
  return out;
}

function main() {
  const data = readJson(IN);
  const predictions = data?.predictions || [];
  if (!predictions.length) throw new Error(`no predictions in ${IN}`);

  // Group by game date, as the backfill did
  const byDate = new Map();
  for (const p of predictions) {
    const date = isoDate(p.next_game?.date) || isoDate(p.created_at);
    const created = new Date(p.created_at).getTime();
    p._date = date; p._created = created;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(p);
  }

  const stats = {};
  const stat = (prop) => stats[prop] || (stats[prop] = { n: 0, event: 0, pick_snapshot: 0, market: 0, priced_at_line: 0, closing: 0, consensus: 0, line_diff_gt_half: 0, pick_after_close: 0 });
  let datesMissing = 0, eventsMissingClosing = 0;
  const minutesToTip = [];

  for (const [date, records] of [...byDate.entries()].sort()) {
    const ev = readJson(path.join(ODDS_DIR, `events_${date}.json`));
    if (!ev) { datesMissing++; for (const p of records) stat(p.prop_type).n++; continue; }
    const batches = batchTimes(records.map(p => p._created).filter(Number.isFinite).sort((a, b) => a - b), BATCH_GAP_MS);

    // Which game is each player in? Union of the player keys over every snapshot of each event
    const events = ev.data.map(e => {
      const tip = new Date(e.commence_time).getTime();
      const closingMs = floor5(tip - CLOSING_LEAD_MS);
      const closing = loadSnapshot(e.id, closingMs);
      if (!closing || closing.empty) eventsMissingClosing++;
      const times = [...new Set([closingMs, ...batches.map(b => snapshotTimeFor(b, batches, closingMs))])];
      const players = new Set();
      for (const ms of times) for (const k of (loadSnapshot(e.id, ms)?.index.keys() || [])) players.add(k);
      return { ...e, tip, closingMs, players };
    });

    for (const p of records) {
      const s = stat(p.prop_type);
      s.n++;
      const key = `${normalizeName(p.player_name)}|${p.prop_type}`;
      // A back-to-back can put two of a player's games on one UTC day: take the first that tips off after the pick
      const candidates = events.filter(e => e.players.has(key)).sort((a, b) => a.tip - b.tip);
      const event = candidates.find(e => e.tip > p._created) || candidates[candidates.length - 1];
      if (!event) continue;
      s.event++;
      const pickMs = snapshotTimeFor(p._created, batches, event.closingMs);
      if (pickMs >= event.closingMs) s.pick_after_close++;
      const pick = loadSnapshot(event.id, pickMs);
      const closingSnap = loadSnapshot(event.id, event.closingMs);
      const line = Number(p.betting_line);
      const backfill = { event_id: event.id, commence_time: event.commence_time, pick_snapshot: pick?.ts || null, close_snapshot: closingSnap?.ts || null, consensus_line: null };

      const pickBooks = pick?.index.get(key);
      if (pickBooks?.length) {
        s.pick_snapshot++;
        const consensus = consensusLine(pickBooks);
        backfill.consensus_line = consensus;
        if (consensus != null) {
          s.consensus++;
          if (Math.abs(consensus - line) > 0.5) s.line_diff_gt_half++;
        }
        const market = summarizeBooks(pickBooks, line, null);
        if (market) {
          p.market = market;
          s.market++;
          if (market.n_books_priced > 0) s.priced_at_line++;
        }
      }
      const closeBooks = closingSnap?.index.get(key);
      if (closeBooks?.length) {
        const closing = buildClosing(closeBooks, { now: new Date(closingSnap.ts).getTime(), tip: event.tip });
        if (closing) { p.closing = closing; s.closing++; minutesToTip.push(closing.minutes_to_tip); }
      }
      p.backfill = backfill;
    }
  }

  for (const p of predictions) { delete p._date; delete p._created; }
  fs.writeFileSync(OUT, JSON.stringify({ ...data, enriched_at: new Date().toISOString(), odds_dir: ODDS_DIR, predictions }));

  // ---- report
  const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
  const tot = { n: 0, event: 0, pick_snapshot: 0, market: 0, priced_at_line: 0, closing: 0, consensus: 0, line_diff_gt_half: 0, pick_after_close: 0 };
  console.log(`\nMatch rates (${predictions.length} records, ${byDate.size} dates${datesMissing ? `, ${datesMissing} dates without an events file` : ''}${eventsMissingClosing ? `, ${eventsMissingClosing} events without a closing snapshot` : ''})`);
  console.log('prop       n      in-game  pick-snap  market   priced@line  closing   |stored-consensus|>0.5  pick>=close');
  for (const prop of Object.keys(stats).sort()) {
    const s = stats[prop];
    for (const k of Object.keys(tot)) tot[k] += s[k];
    console.log(`${prop.padEnd(10)} ${String(s.n).padStart(5)}  ${pct(s.event, s.n).padStart(7)}  ${pct(s.pick_snapshot, s.n).padStart(8)}  ${pct(s.market, s.n).padStart(7)}  ${pct(s.priced_at_line, s.n).padStart(10)}  ${pct(s.closing, s.n).padStart(7)}  ${pct(s.line_diff_gt_half, s.consensus).padStart(20)}  ${pct(s.pick_after_close, s.event).padStart(10)}`);
  }
  const s = tot;
  console.log(`${'all'.padEnd(10)} ${String(s.n).padStart(5)}  ${pct(s.event, s.n).padStart(7)}  ${pct(s.pick_snapshot, s.n).padStart(8)}  ${pct(s.market, s.n).padStart(7)}  ${pct(s.priced_at_line, s.n).padStart(10)}  ${pct(s.closing, s.n).padStart(7)}  ${pct(s.line_diff_gt_half, s.consensus).padStart(20)}  ${pct(s.pick_after_close, s.event).padStart(10)}`);
  if (minutesToTip.length) {
    const sorted = [...minutesToTip].sort((a, b) => a - b);
    console.log(`closing snapshot minutes before tip: median ${sorted[Math.floor(sorted.length / 2)]}, min ${sorted[0]}, max ${sorted[sorted.length - 1]}`);
  }

  // ---- closing line value of the old pipeline (records predate model_variant, so they grade as 'legacy')
  const summary = gradeEdgePredictions(predictions, { variant: 'legacy' });
  const fmt = (c) => c ? `n=${c.n} priced=${c.n_priced} mean line CLV ${c.mean_line ?? '-'} mean price CLV ${c.mean_points ?? '-'} pts, beat close ${c.beat_close == null ? '-' : (100 * c.beat_close).toFixed(1) + '%'} (of ${c.beat_close_n})` : '-';
  console.log('\nClosing line value, old pipeline (picks = OVER/UNDER recommendations; leans = everything else)');
  console.log(`overall picks: ${fmt(summary.overall?.clv?.picks)}`);
  console.log(`overall leans: ${fmt(summary.overall?.clv?.leans)}`);
  for (const [prop, b] of Object.entries(summary.by_prop || {})) console.log(`  ${prop.padEnd(9)} picks: ${fmt(b.clv?.picks)}`);
  console.log(`\nWrote ${predictions.length} records to ${OUT}`);
}

main();
