import admin from 'firebase-admin';
import { getPlayerStats } from './nbaApiService.js';

/**
 * Server-side cron that resolves ALL users' pending predictions.
 * Runs periodically on Railway so predictions resolve even when users are offline.
 */

const statMap = {
  'points': g => g.pts ?? g.points ?? 0,
  'rebounds': g => g.reb ?? g.rebounds ?? 0,
  'assists': g => g.ast ?? g.assists ?? 0,
  'threes': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
  'threes_made': g => g.tpm ?? g.threes ?? g.three_pointers_made ?? 0,
  'steals': g => g.stl ?? g.steals ?? 0,
  'blocks': g => g.blk ?? g.blocks ?? 0,
  'turnovers': g => g.turnovers ?? 0,
  'pra': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
  'points_rebounds_assists': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
  'pr': g => (g.pts ?? 0) + (g.reb ?? 0),
  'points_rebounds': g => (g.pts ?? 0) + (g.reb ?? 0),
  'pa': g => (g.pts ?? 0) + (g.ast ?? 0),
  'points_assists': g => (g.pts ?? 0) + (g.ast ?? 0),
  'ra': g => (g.reb ?? 0) + (g.ast ?? 0),
  'rebounds_assists': g => (g.reb ?? 0) + (g.ast ?? 0),
};

export async function resolveAllPendingPredictions() {
  if (!admin.apps.length) {
    console.log('[Cron] Firebase Admin not initialized, skipping resolution');
    return { resolved: 0, failed: 0 };
  }

  const db = admin.firestore();

  // Query all predictions without a result
  const snapshot = await db.collection('predictions')
    .where('result', '==', null)
    .get();

  if (snapshot.empty) {
    return { resolved: 0, failed: 0 };
  }

  console.log(`[Cron] Found ${snapshot.size} unresolved predictions`);

  // Group by player to minimize API calls
  const byPlayer = {};
  const docsById = {};
  snapshot.forEach(doc => {
    const data = { id: doc.id, ...doc.data() };
    docsById[doc.id] = data;
    const player = data.playerName;
    if (!player) return;
    if (!byPlayer[player]) byPlayer[player] = [];
    byPlayer[player].push(data);
  });

  let resolved = 0;
  let failed = 0;

  // Track which users need token/record updates
  const userUpdates = {}; // userId -> { tokenChange, predictionIds }

  for (const [playerName, preds] of Object.entries(byPlayer)) {
    try {
      const stats = await getPlayerStats(playerName);
      if (!stats?.games?.length) continue;

      for (const pred of preds) {
        try {
          const targetDate = new Date(pred.gameDate);
          if (isNaN(targetDate.getTime())) continue;

          const matchingGame = stats.games.find(g => {
            const gd = new Date(g.date);
            return gd.getFullYear() === targetDate.getFullYear() &&
                   gd.getMonth() === targetDate.getMonth() &&
                   gd.getDate() === targetDate.getDate();
          });

          if (!matchingGame) continue;

          const extractor = statMap[pred.propType] || statMap['points'];
          const actualValue = extractor(matchingGame);
          const line = parseFloat(pred.line);

          let result;
          if (actualValue > line) result = pred.pick === 'over' ? 'win' : 'loss';
          else if (actualValue < line) result = pred.pick === 'under' ? 'win' : 'loss';
          else result = 'push';

          // Calculate payout
          const wager = pred.wager || 0;
          const odds = pred.oddsUsed;
          let actualPayout = 0;

          if (wager > 0 && odds != null) {
            if (result === 'win') {
              const profit = odds > 0
                ? wager * (odds / 100)
                : wager * (100 / Math.abs(odds));
              actualPayout = Math.round(wager + profit);
            } else if (result === 'push') {
              actualPayout = wager;
            }
          } else if (wager === 0 && result === 'win') {
            actualPayout = 10;
          }

          // Update prediction doc
          await db.collection('predictions').doc(pred.id).update({
            result,
            actualValue,
            actualPayout,
          });

          // Track user updates
          const uid = pred.userId;
          if (uid) {
            if (!userUpdates[uid]) userUpdates[uid] = { tokenChange: 0, ids: [] };
            userUpdates[uid].tokenChange += actualPayout;
            userUpdates[uid].ids.push(pred.id);
          }

          resolved++;
        } catch (err) {
          failed++;
        }
      }

      // Rate limit between players
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Cron] Error fetching stats for ${playerName}:`, err.message);
      failed += preds.length;
    }
  }

  // Update user tokens and records
  for (const [userId, update] of Object.entries(userUpdates)) {
    try {
      // Recalculate full record from all predictions
      const allSnap = await db.collection('predictions')
        .where('userId', '==', userId)
        .get();
      const allPreds = allSnap.docs.map(d => d.data());
      const wins = allPreds.filter(p => p.result === 'win').length;
      const losses = allPreds.filter(p => p.result === 'loss').length;
      const pushes = allPreds.filter(p => p.result === 'push').length;

      const userUpdate = { record: { wins, losses, pushes } };
      if (update.tokenChange > 0) {
        userUpdate.tokens = admin.firestore.FieldValue.increment(update.tokenChange);
      }
      await db.collection('users').doc(userId).update(userUpdate);
    } catch (err) {
      console.error(`[Cron] Error updating user ${userId}:`, err.message);
    }
  }

  console.log(`[Cron] Resolution complete: ${resolved} resolved, ${failed} failed`);
  return { resolved, failed };
}
