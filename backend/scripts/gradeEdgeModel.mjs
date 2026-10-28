#!/usr/bin/env node
/**
 * Grade the edge model's live predictions against what actually happened.
 *
 *   node backend/scripts/gradeEdgeModel.mjs [--in FILE] [--pull [--base URL]] [--variant edge|anchored|legacy|all] [--out FILE]
 *
 * Input: an export from pullPredictions.mjs ({ predictions: [...] }), default
 * backend/data/predictions_export_fv.json, else predictions_export.json, else
 * the local backend/data/predictions.json. With --pull it first downloads a
 * fresh evaluated export from production (or --base) with pullPredictions.mjs
 * (feature vectors are not needed for grading, so the pull is small).
 *
 * Only model_variant === 'edge' records are graded unless --variant says
 * otherwise ('legacy' = stored before the variant field existed, i.e. the old
 * anchored pipeline's history).
 *
 * Prints a console table and writes a JSON summary to
 * backend/data/edge_grading.json (gitignored) with the same shape as
 * GET /api/performance/edge; see services/edgeGradingService.js for the fields.
 *
 * Exit code is 0 even when nothing is gradable yet (the summary says so), so a
 * scheduled run does not fail in the first weeks after a model change.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { gradeEdgePredictions, formatGradingReport } from '../services/edgeGradingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const DATA_DIR = path.join(__dirname, '../data');
const VARIANT = opt('--variant', 'edge');
const VERSION = opt('--version', 'all'); // 'all', 'current' (what the site grades), or a version stamp
const OUT = opt('--out', path.join(DATA_DIR, 'edge_grading.json'));
const candidates = ['predictions_export_fv.json', 'predictions_export.json', 'predictions.json'].map(f => path.join(DATA_DIR, f));
let IN = opt('--in', null);

if (flag('--pull')) {
  IN = IN || path.join(DATA_DIR, 'predictions_export.json');
  const pullArgs = [path.join(__dirname, 'pullPredictions.mjs'), '--out', IN];
  if (opt('--base', null)) pullArgs.push('--base', opt('--base'));
  const r = spawnSync(process.execPath, pullArgs, { stdio: 'inherit' });
  if (r.status !== 0) { console.error('Pull failed'); process.exit(r.status || 1); }
}
IN = IN || candidates.find(f => fs.existsSync(f));
if (!IN || !fs.existsSync(IN)) {
  console.error(`No input file found (looked for ${candidates.map(f => path.relative(process.cwd(), f)).join(', ')}); pass --in FILE or --pull`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const predictions = raw.predictions || raw;
console.log(`Loaded ${predictions.length} predictions from ${path.relative(process.cwd(), IN)}${raw.exported_at ? ` (exported ${raw.exported_at.slice(0, 16)} from ${raw.source})` : ''}\n`);

const summary = gradeEdgePredictions(predictions, { variant: VARIANT, version: VERSION });
summary.source = { file: path.basename(IN), exported_at: raw.exported_at || null, records: predictions.length };
console.log(formatGradingReport(summary));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
