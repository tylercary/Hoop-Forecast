/**
 * Off-volume backups of the prediction store (DATA_DIR/predictions.sqlite).
 *
 * Nightly (BACKUP_HOUR_UTC, default 09:00 UTC) the database is copied with
 * VACUUM INTO to DATA_DIR/backups/predictions-<timestamp>.sqlite: a complete,
 * consistent, compacted database that opens on its own. The last BACKUP_KEEP
 * copies (default 7) are kept on the volume; older ones are deleted.
 *
 * The copy then leaves the volume through every target that is configured
 * (all optional; set none and the file only stays on the volume):
 *
 *   BACKUP_WEBHOOK_URL     POST the file there as application/octet-stream.
 *                          Headers: X-Backup-Name (file name), X-Backup-Size,
 *                          Content-Disposition. BACKUP_WEBHOOK_TOKEN, when set,
 *                          is sent as "Authorization: Bearer <token>".
 *   BLOB_READ_WRITE_TOKEN  Vercel Blob: the file is PUT to
 *                          https://blob.vercel-storage.com/<BACKUP_BLOB_PREFIX><name>
 *                          (BACKUP_BLOB_PREFIX default "backups/").
 *   BACKUP_S3_BUCKET       S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze
 *                          B2, MinIO...). Needs AWS_ACCESS_KEY_ID and
 *                          AWS_SECRET_ACCESS_KEY (or BACKUP_S3_ACCESS_KEY_ID /
 *                          BACKUP_S3_SECRET_ACCESS_KEY). Optional:
 *                          BACKUP_S3_REGION (default us-east-1),
 *                          BACKUP_S3_ENDPOINT (e.g. https://<account>.r2.cloudflarestorage.com;
 *                          default AWS virtual-hosted URL),
 *                          BACKUP_S3_PREFIX (default "predictions/").
 *
 * Whatever is configured, the latest copy can always be pulled by hand or by
 * a workflow: GET /api/performance/backup (x-admin-key: ADMIN_KEY) streams it
 * (?fresh=1 makes a new copy first). /api/health reports last_backup_at.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDatabase, DB_FILE, DATA_DIR } from './predictionTrackingService.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 7);
const HOUR_UTC = Number.isFinite(parseInt(process.env.BACKUP_HOUR_UTC, 10)) ? parseInt(process.env.BACKUP_HOUR_UTC, 10) : 9;
const DAY_MS = 24 * 60 * 60 * 1000;

const state = { last_backup_at: null, last_file: null, last_error: null, last_uploads: [], running: false };

/** Backup files on the volume, newest first. */
export function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => /^predictions-.*\.sqlite$/.test(f))
      .sort()
      .reverse()
      .map(f => {
        const file = path.join(BACKUP_DIR, f);
        const st = fs.statSync(file);
        return { name: f, file, size: st.size, mtime: st.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

export function latestBackup() {
  return listBackups()[0] || null;
}

/** Targets the environment configures (names only, for logs and health). */
export function configuredTargets() {
  const targets = [];
  if (process.env.BACKUP_WEBHOOK_URL) targets.push('webhook');
  if (process.env.BLOB_READ_WRITE_TOKEN) targets.push('vercel-blob');
  if (process.env.BACKUP_S3_BUCKET) targets.push('s3');
  return targets;
}

/** For /api/health. last_backup_at falls back to the newest file on the volume. */
export function getBackupStatus() {
  const latest = latestBackup();
  return {
    last_backup_at: state.last_backup_at || latest?.mtime || null,
    last_file: state.last_file || latest?.name || null,
    last_error: state.last_error,
    uploads: state.last_uploads,
    targets: configuredTargets(),
    kept: listBackups().length
  };
}

function prune() {
  const removed = [];
  for (const b of listBackups().slice(KEEP)) {
    try { fs.unlinkSync(b.file); removed.push(b.name); } catch (error) {
      console.warn(`[Backup] Could not delete ${b.file}:`, error.message);
    }
  }
  return removed;
}

/**
 * Write a fresh copy of the database. VACUUM INTO reads a consistent snapshot
 * while the app keeps writing, and writes a compacted file with no WAL.
 */
export function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `predictions-${stamp}.sqlite`);
  const tmp = `${file}.tmp`;
  try { fs.unlinkSync(tmp); } catch { /* none */ }
  getDatabase().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file);
  const size = fs.statSync(file).size;
  return { name: path.basename(file), file, size };
}

// ---------------------------------------------------------------------------
// Upload targets
// ---------------------------------------------------------------------------

async function uploadWebhook(backup) {
  const url = process.env.BACKUP_WEBHOOK_URL;
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${backup.name}"`,
    'X-Backup-Name': backup.name,
    'X-Backup-Size': String(backup.size)
  };
  if (process.env.BACKUP_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.BACKUP_WEBHOOK_TOKEN}`;
  const res = await fetch(url, { method: 'POST', headers, body: fs.readFileSync(backup.file) });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  return { target: 'webhook', status: res.status };
}

async function uploadVercelBlob(backup) {
  const prefix = process.env.BACKUP_BLOB_PREFIX ?? 'backups/';
  const pathname = `${prefix}${backup.name}`;
  const res = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      'x-api-version': '7',
      'x-content-type': 'application/octet-stream',
      'x-add-random-suffix': '0'
    },
    body: fs.readFileSync(backup.file)
  });
  if (!res.ok) throw new Error(`Vercel Blob responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json().catch(() => ({}));
  return { target: 'vercel-blob', status: res.status, url: body.url || null };
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** PUT the file with AWS Signature V4 (works for S3, R2, B2 and other S3-compatible stores). */
async function uploadS3(backup) {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION || 'us-east-1';
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) throw new Error('BACKUP_S3_BUCKET is set but no access key / secret');
  const prefix = process.env.BACKUP_S3_PREFIX ?? 'predictions/';
  const key = `${prefix}${backup.name}`;

  let base;
  if (process.env.BACKUP_S3_ENDPOINT) {
    base = new URL(process.env.BACKUP_S3_ENDPOINT);
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${bucket}/${key}`;
  } else {
    base = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
  }
  const host = base.host;
  const canonicalUri = base.pathname.split('/').map(s => encodeURIComponent(decodeURIComponent(s))).join('/');

  const body = fs.readFileSync(backup.file);
  const payloadHash = sha256(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host,
    'content-type': 'application/octet-stream',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(h => `${h}:${headers[h]}\n`).join('');
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(base.toString(), {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization, 'Content-Length': String(body.length) },
    body
  });
  if (!res.ok) throw new Error(`S3 responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { target: 's3', status: res.status, key };
}

async function uploadEverywhere(backup) {
  const jobs = [];
  if (process.env.BACKUP_WEBHOOK_URL) jobs.push(uploadWebhook(backup));
  if (process.env.BLOB_READ_WRITE_TOKEN) jobs.push(uploadVercelBlob(backup));
  if (process.env.BACKUP_S3_BUCKET) jobs.push(uploadS3(backup));
  const results = await Promise.allSettled(jobs);
  return results.map(r => r.status === 'fulfilled'
    ? { ...r.value, ok: true }
    : { ok: false, error: r.reason?.message || String(r.reason) });
}

/**
 * Create a backup, prune old ones and (unless upload=false) push it to every
 * configured target. Never throws from the upload step; failures are logged and
 * shown in /api/health.
 */
export async function runBackup({ upload = true } = {}) {
  if (state.running) return { skipped: 'already running' };
  state.running = true;
  const started = Date.now();
  try {
    const backup = createBackup();
    const pruned = prune();
    state.last_backup_at = new Date().toISOString();
    state.last_file = backup.name;
    state.last_error = null;
    console.log(`[Backup] Wrote ${backup.name} (${(backup.size / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - started}ms; pruned ${pruned.length}`);
    let uploads = [];
    if (upload) {
      uploads = await uploadEverywhere(backup);
      state.last_uploads = uploads;
      for (const u of uploads) {
        if (u.ok) console.log(`[Backup] Uploaded ${backup.name} to ${u.target}`);
        else console.error(`[Backup] Upload failed: ${u.error}`);
      }
      const failed = uploads.filter(u => !u.ok);
      if (failed.length) state.last_error = failed.map(u => u.error).join('; ');
    }
    return { ...backup, pruned, uploads, at: state.last_backup_at };
  } catch (error) {
    state.last_error = error.message;
    console.error('[Backup] Failed:', error.message);
    throw error;
  } finally {
    state.running = false;
  }
}

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), HOUR_UTC, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

/** Run every day at BACKUP_HOUR_UTC. Timers are unref'd so they never keep the process alive. */
export function scheduleBackups() {
  const first = msUntilNextRun();
  const t = setTimeout(() => {
    runBackup().catch(() => {});
    const i = setInterval(() => runBackup().catch(() => {}), DAY_MS);
    if (typeof i.unref === 'function') i.unref();
  }, first);
  if (typeof t.unref === 'function') t.unref();
  console.log(`[Backup] Next backup in ${(first / 3600000).toFixed(1)}h (daily at ${String(HOUR_UTC).padStart(2, '0')}:00 UTC; targets: ${configuredTargets().join(', ') || 'none, download via /api/performance/backup'})`);
  return first;
}
