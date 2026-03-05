import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
  increment,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import api from '../utils/api';

// ─── Predictions ────────────────────────────────────────────

export async function savePrediction(userId, data) {
  const docRef = await addDoc(collection(db, 'predictions'), {
    userId,
    userName: data.userName,
    playerId: data.playerId,
    playerName: data.playerName,
    propType: data.propType,
    line: data.line,
    pick: data.pick,
    gameDate: data.gameDate,
    opponent: data.opponent || '',
    commenceTime: data.commenceTime || null,
    wager: data.wager || 0,
    oddsUsed: data.oddsUsed || null,
    createdAt: serverTimestamp(),
    result: null,
    actualValue: null,
  });
  return docRef;
}

export async function updatePrediction(predictionId, updates) {
  const predRef = doc(db, 'predictions', predictionId);
  await updateDoc(predRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deletePrediction(predictionId) {
  await deleteDoc(doc(db, 'predictions', predictionId));
}

export async function getCommunityPicks(playerId, propType, gameDate) {
  const q = query(
    collection(db, 'predictions'),
    where('playerId', '==', String(playerId))
  );
  const snap = await getDocs(q);

  let overCount = 0;
  let underCount = 0;

  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.propType === propType && data.gameDate === gameDate) {
      if (data.pick === 'over') overCount++;
      else if (data.pick === 'under') underCount++;
    }
  });

  const total = overCount + underCount;
  return {
    overCount,
    underCount,
    total,
    overPercent: total > 0 ? Math.round((overCount / total) * 100) : 50,
    underPercent: total > 0 ? Math.round((underCount / total) * 100) : 50,
  };
}

export async function getUserPredictions(userId) {
  const q = query(
    collection(db, 'predictions'),
    where('userId', '==', userId)
  );
  const snap = await getDocs(q);
  const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Sort client-side by createdAt desc (avoids needing composite index)
  results.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
    const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
    return bTime - aTime;
  });
  return results;
}

export async function getUserRecord(userId) {
  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) return { wins: 0, losses: 0, pushes: 0 };
  return userDoc.data().record || { wins: 0, losses: 0, pushes: 0 };
}

/**
 * Recalculate and sync the user's record from their actual predictions.
 * Fixes any stale/duplicated record data in Firestore.
 */
export async function syncUserRecord(userId, predictions) {
  const wins = predictions.filter((p) => p.result === 'win').length;
  const losses = predictions.filter((p) => p.result === 'loss').length;
  const pushes = predictions.filter((p) => p.result === 'push').length;
  await updateDoc(doc(db, 'users', userId), {
    record: { wins, losses, pushes },
  });
  return { wins, losses, pushes };
}

/**
 * Resolve pending predictions by checking actual game results via backend.
 * Calls the backend to fetch real game stats, then updates Firestore docs.
 * Also updates the user's win/loss/push record.
 */
export async function resolvePendingPredictions(userId, predictions) {
  const pending = predictions.filter((p) => !p.result);
  if (pending.length === 0) return { resolved: 0, updates: [] };

  // Call backend to resolve
  const payload = pending.map((p) => ({
    id: p.id,
    playerName: p.playerName,
    playerId: p.playerId,
    propType: p.propType,
    line: p.line,
    pick: p.pick,
    gameDate: p.gameDate,
  }));

  const { data } = await api.post('/player/resolve-predictions', { predictions: payload });
  if (!data.resolved?.length) return { resolved: 0, updates: [] };

  // Build a map from pending predictions for wager/odds lookup
  const pendingMap = {};
  pending.forEach((p) => { pendingMap[p.id] = p; });

  // Update each resolved prediction in Firestore and calculate payouts
  const updates = [];
  let totalTokenChange = 0;

  for (const r of data.resolved) {
    const orig = pendingMap[r.id];
    const wager = orig?.wager || 0;
    const odds = orig?.oddsUsed;
    let actualPayout = 0;

    if (wager > 0 && odds != null) {
      if (r.result === 'win') {
        const profit = odds > 0
          ? wager * (odds / 100)
          : wager * (100 / Math.abs(odds));
        actualPayout = Math.round(wager + profit);
        totalTokenChange += actualPayout; // wager was already deducted at pick time
      } else if (r.result === 'push') {
        actualPayout = wager; // refund
        totalTokenChange += wager;
      }
      // loss: actualPayout = 0, tokens already gone
    } else if (wager === 0 && r.result === 'win') {
      actualPayout = 10; // flat reward for correct no-wager pick
      totalTokenChange += 10;
    }

    await updateDoc(doc(db, 'predictions', r.id), {
      result: r.result,
      actualValue: r.actualValue,
      actualPayout: actualPayout,
    });
    updates.push({ ...r, actualPayout });
  }

  // Recalculate full record from ALL predictions (prevents double-counting)
  if (updates.length > 0) {
    const allPreds = await getUserPredictions(userId);
    const wins = allPreds.filter((p) => p.result === 'win').length;
    const losses = allPreds.filter((p) => p.result === 'loss').length;
    const pushes = allPreds.filter((p) => p.result === 'push').length;

    const userUpdate = { record: { wins, losses, pushes } };
    if (totalTokenChange > 0) {
      userUpdate.tokens = increment(totalTokenChange);
    }
    await updateDoc(doc(db, 'users', userId), userUpdate);
  }

  return { resolved: updates.length, updates, totalTokenChange };
}

// ─── Friends ────────────────────────────────────────────────

export async function searchUsers(searchTerm) {
  if (!searchTerm || searchTerm.length < 2) return [];
  const lower = searchTerm.toLowerCase();
  const q = query(
    collection(db, 'users'),
    where('searchableName', '>=', lower),
    where('searchableName', '<=', lower + '\uf8ff'),
    limit(10)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function sendFriendRequest(fromUid, fromName, toUid, toName) {
  // Check for existing friendship — use single where + client filter
  const q = query(
    collection(db, 'friendships'),
    where('fromUserId', 'in', [fromUid, toUid])
  );
  const snap = await getDocs(q);
  const existing = snap.docs.find((d) => {
    const data = d.data();
    return (
      (data.fromUserId === fromUid && data.toUserId === toUid) ||
      (data.fromUserId === toUid && data.toUserId === fromUid)
    );
  });
  if (existing) {
    throw new Error('Friend request already exists');
  }

  return addDoc(collection(db, 'friendships'), {
    fromUserId: fromUid,
    fromUserName: fromName,
    toUserId: toUid,
    toUserName: toName,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function acceptFriendRequest(friendshipId) {
  return updateDoc(doc(db, 'friendships', friendshipId), {
    status: 'accepted',
  });
}

export async function declineFriendRequest(friendshipId) {
  return deleteDoc(doc(db, 'friendships', friendshipId));
}

export async function getFriends(userId) {
  // Get all friendships involving this user, filter client-side
  const q1 = query(
    collection(db, 'friendships'),
    where('fromUserId', '==', userId)
  );
  const q2 = query(
    collection(db, 'friendships'),
    where('toUserId', '==', userId)
  );
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

  const friends = [];
  snap1.docs.forEach((d) => {
    const data = d.data();
    if (data.status === 'accepted') {
      friends.push({ friendshipId: d.id, uid: data.toUserId, name: data.toUserName });
    }
  });
  snap2.docs.forEach((d) => {
    const data = d.data();
    if (data.status === 'accepted') {
      friends.push({ friendshipId: d.id, uid: data.fromUserId, name: data.fromUserName });
    }
  });
  return friends;
}

export async function getPendingRequests(userId) {
  // Single where + client filter
  const q = query(
    collection(db, 'friendships'),
    where('toUserId', '==', userId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'pending');
}

export async function getFriendshipStatus(currentUid, otherUid) {
  const q1 = query(
    collection(db, 'friendships'),
    where('fromUserId', '==', currentUid)
  );
  const q2 = query(
    collection(db, 'friendships'),
    where('fromUserId', '==', otherUid)
  );
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

  for (const d of snap1.docs) {
    if (d.data().toUserId === otherUid) return { id: d.id, ...d.data() };
  }
  for (const d of snap2.docs) {
    if (d.data().toUserId === currentUid) return { id: d.id, ...d.data() };
  }
  return null;
}

// ─── User Profile ───────────────────────────────────────────

export async function getUserProfile(userId) {
  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) return null;
  return { uid: userId, ...userDoc.data() };
}

export async function deleteUserData(userId) {
  // Delete all predictions by this user
  const predsSnap = await getDocs(query(collection(db, 'predictions'), where('userId', '==', userId)));
  for (const d of predsSnap.docs) await deleteDoc(d.ref);

  // Delete all friendships involving this user
  const q1 = query(collection(db, 'friendships'), where('fromUserId', '==', userId));
  const q2 = query(collection(db, 'friendships'), where('toUserId', '==', userId));
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  for (const d of [...snap1.docs, ...snap2.docs]) await deleteDoc(d.ref);

  // Delete user document
  await deleteDoc(doc(db, 'users', userId));
}

// ─── Leaderboard ────────────────────────────────────────────

export async function getLeaderboard() {
  // Fetch all users and all predictions, compute records from predictions (single source of truth)
  const [usersSnap, predsSnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('usernameSet', '==', true))),
    getDocs(collection(db, 'predictions')),
  ]);

  // Group predictions by userId and compute records
  const recordsByUser = {};
  predsSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data.userId || !data.result) return;
    if (!recordsByUser[data.userId]) recordsByUser[data.userId] = { wins: 0, losses: 0, pushes: 0 };
    if (data.result === 'win') recordsByUser[data.userId].wins++;
    else if (data.result === 'loss') recordsByUser[data.userId].losses++;
    else if (data.result === 'push') recordsByUser[data.userId].pushes++;
  });

  // Count total picks (including pending) per user
  const totalPicksByUser = {};
  predsSnap.docs.forEach((d) => {
    const uid = d.data().userId;
    if (uid) totalPicksByUser[uid] = (totalPicksByUser[uid] || 0) + 1;
  });

  return usersSnap.docs
    .map((d) => {
      const userData = d.data();
      const computed = recordsByUser[d.id] || { wins: 0, losses: 0, pushes: 0 };
      return {
        uid: d.id,
        displayName: userData.displayName,
        photoURL: userData.photoURL || null,
        record: computed,
        totalPicks: totalPicksByUser[d.id] || 0,
        tokens: userData.tokens || 0,
      };
    })
    .filter((u) => u.totalPicks > 0);
}

// ─── Comments ────────────────────────────────────────────

export async function addComment(data) {
  return addDoc(collection(db, 'comments'), {
    gameId: data.gameId || null,
    playerId: data.playerId || null,
    type: data.type,
    userId: data.userId,
    userName: data.userName,
    userPhoto: data.userPhoto || null,
    text: data.text,
    createdAt: serverTimestamp(),
  });
}

export async function deleteComment(commentId) {
  return deleteDoc(doc(db, 'comments', commentId));
}

export function subscribeToComments(type, targetId, callback) {
  const field = type === 'game' ? 'gameId' : 'playerId';
  const q = query(
    collection(db, 'comments'),
    where(field, '==', targetId),
    where('type', '==', type)
  );

  return onSnapshot(q, (snapshot) => {
    const comments = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });
    callback(comments);
  }, (err) => {
    console.error('Comments subscription error:', err.message);
    if (err.message?.includes('index')) {
      console.error('Firestore composite index required. Check the link in the error above.');
    }
    callback([]);
  });
}
