#!/usr/bin/env node
/**
 * Pull the evaluated prediction history from a running backend into a local
 * JSON file, for calibration and retraining.
 *
 *   node backend/scripts/pullPredictions.mjs [--base URL] [--features] [--all] [--with-archive] [--out FILE]
 *
 * --with-archive also pulls the archived history (predictions from earlier
 * models, moved out of the live store), which training still needs.
 *
 * Defaults: production API, evaluated predictions only, no feature vectors,
 * written to backend/data/predictions_export.json (gitignored).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = opt('--base', 'https://zealous-kindness-production-3ecb.up.railway.app/api').replace(/\/$/, '');
const features = flag('--features') ? '1' : '0';
const evaluated = flag('--all') ? '0' : '1';
const out = opt('--out', path.join(__dirname, '../data/predictions_export.json'));
const limit = features === '1' ? 500 : 2000;

const all = [];
const sources = flag('--with-archive') ? ['live', 'archive'] : ['live'];
for (const source of sources) {
  let offset = 0;
  let total = null;
  let pulled = 0;
  while (total === null || offset < total) {
    const url = `${base}/performance/export?offset=${offset}&limit=${limit}&evaluated=${evaluated}&features=${features}&source=${source}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    const page = await res.json();
    total = page.total;
    all.push(...page.predictions);
    pulled += page.predictions.length;
    offset += limit;
    process.stdout.write(`\r${source}: ${pulled}/${total}`);
    if (page.predictions.length === 0) break;
  }
  process.stdout.write('\n');
}
fs.writeFileSync(out, JSON.stringify({ exported_at: new Date().toISOString(), source: base, predictions: all }));
console.log(`Wrote ${all.length} predictions to ${out}`);
