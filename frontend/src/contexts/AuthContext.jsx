import { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword as firebaseUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser as firebaseDeleteUser,
  signOut,
} from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, googleProvider, db, storage } from '../firebase';
import { deleteUserData, getUserPredictions, resolvePendingPredictions } from '../services/firestoreService';

const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState([]);
  const [favoriteTeams, setFavoriteTeams] = useState([]);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [dailyBonusClaimed, setDailyBonusClaimed] = useState(false);
  const [predictionsResolved, setPredictionsResolved] = useState(false);
  const resolvedRef = useRef(false);

  // Listen for auth state changes
  useEffect(() => {
    // Safety timeout — always show UI after 3 seconds even if Firestore is slow
    const timeout = setTimeout(() => setLoading(false), 3000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          await loadFavorites(firebaseUser.uid);
          // Fire-and-forget: resolve pending predictions in background
          resolveOnLogin(firebaseUser.uid);
        } catch (err) {
          console.error('Error loading favorites on auth change:', err);
        }
      } else {
        setFavorites([]);
        setFavoriteTeams([]);
        setPredictionsResolved(false);
        resolvedRef.current = false;
      }
      setLoading(false);
      clearTimeout(timeout);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Load favorites from Firestore
  async function loadFavorites(uid) {
    try {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setFavorites(data.favorites || []);
        setFavoriteTeams(data.favoriteTeams || []);
        setTokens(data.tokens || 0);
        // Auto-claim daily tokens
        await claimDailyTokens(uid, data);
        // Prompt if user never explicitly chose a username
        if (!data.usernameSet) {
          setNeedsUsername(true);
        }
      } else {
        // New user — prompt for username before creating doc
        setNeedsUsername(true);
        setFavorites([]);
        setFavoriteTeams([]);
        setTokens(0);
      }
    } catch (err) {
      console.error('Error loading favorites:', err);
      setFavorites([]);
      setFavoriteTeams([]);
    }
  }

  async function claimDailyTokens(uid, userData) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    if (userData?.lastDailyClaimDate === today) return; // Already claimed today
    const newTokens = (userData?.tokens || 0) + 50;
    await setDoc(doc(db, 'users', uid), {
      tokens: newTokens,
      lastDailyClaimDate: today,
    }, { merge: true });
    setTokens(newTokens);
    setDailyBonusClaimed(true);
  }

  function dismissDailyBonus() {
    setDailyBonusClaimed(false);
  }

  async function resolveOnLogin(uid) {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    try {
      const predictions = await getUserPredictions(uid);
      const hasPending = predictions.some((p) => !p.result);
      if (!hasPending) {
        setPredictionsResolved(true);
        return;
      }
      const { totalTokenChange } = await resolvePendingPredictions(uid, predictions);
      // Re-read tokens from Firestore to stay in sync after resolution
      if (totalTokenChange > 0) {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
          setTokens(userDoc.data().tokens || 0);
        }
      }
      setPredictionsResolved(true);
    } catch (err) {
      console.error('Error resolving predictions on login:', err);
      setPredictionsResolved(true); // Mark done even on error so MyPredictions can try its own
    }
  }

  async function deductTokens(amount) {
    if (!user) return;
    const newTokens = Math.max(0, tokens - amount);
    setTokens(newTokens);
    await setDoc(doc(db, 'users', user.uid), { tokens: newTokens }, { merge: true });
  }

  async function addTokens(amount) {
    if (!user) return;
    const newTokens = tokens + amount;
    setTokens(newTokens);
    await setDoc(doc(db, 'users', user.uid), { tokens: newTokens }, { merge: true });
  }

  async function setUsername(username) {
    if (!user) return;
    const trimmed = username.trim();
    if (!trimmed) return;
    // Update Firebase Auth profile
    await updateProfile(user, { displayName: trimmed });
    // Create or update Firestore user document (merge so we don't overwrite existing favorites)
    const today = new Date().toISOString().slice(0, 10);
    await setDoc(doc(db, 'users', user.uid), {
      displayName: trimmed,
      searchableName: trimmed.toLowerCase(),
      usernameSet: true,
      record: { wins: 0, losses: 0, pushes: 0 },
      profilePublic: true,
      tokens: 50,
      lastDailyClaimDate: today,
      createdAt: new Date().toISOString(),
    }, { merge: true });
    setTokens(50);
    setNeedsUsername(false);
    // Reload the actual Firebase user so UI picks up the new displayName
    await auth.currentUser.reload();
    setUser(auth.currentUser);
  }

  async function signInWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  }

  async function signInWithEmail(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  }

  async function signUp(email, password, displayName) {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(result.user, { displayName });
    }
    return result.user;
  }

  async function logout() {
    setUser(null);
    setFavorites([]);
    setFavoriteTeams([]);
    setTokens(0);
    setNeedsUsername(false);
    setDailyBonusClaimed(false);
    setPredictionsResolved(false);
    resolvedRef.current = false;
    await signOut(auth);
  }

  async function toggleFavorite(playerId, playerName) {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const existing = favorites.find((f) => f.playerId === playerId);

    try {
      if (existing) {
        // Remove favorite — update local state first for instant UI feedback
        setFavorites((prev) => prev.filter((f) => f.playerId !== playerId));
        await setDoc(userRef, { favorites: favorites.filter((f) => f.playerId !== playerId) }, { merge: true });
      } else {
        // Add favorite — update local state first for instant UI feedback
        const fav = { playerId, playerName, addedAt: new Date().toISOString() };
        setFavorites((prev) => [...prev, fav]);
        await setDoc(userRef, { favorites: [...favorites, fav] }, { merge: true });
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      // Revert on failure
      await loadFavorites(user.uid);
    }
  }

  function isFavorite(playerId) {
    return favorites.some((f) => f.playerId === playerId);
  }

  async function toggleFavoriteTeam(teamAbbreviation, teamName) {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const existing = favoriteTeams.find((f) => f.teamAbbreviation === teamAbbreviation);

    try {
      if (existing) {
        const updated = favoriteTeams.filter((f) => f.teamAbbreviation !== teamAbbreviation);
        setFavoriteTeams(updated);
        await setDoc(userRef, { favoriteTeams: updated }, { merge: true });
      } else {
        const fav = { teamAbbreviation, teamName, addedAt: new Date().toISOString() };
        const updated = [...favoriteTeams, fav];
        setFavoriteTeams(updated);
        await setDoc(userRef, { favoriteTeams: updated }, { merge: true });
      }
    } catch (err) {
      console.error('Error toggling team favorite:', err);
      await loadFavorites(user.uid);
    }
  }

  function isTeamFavorite(teamAbbreviation) {
    return favoriteTeams.some((f) => f.teamAbbreviation === teamAbbreviation);
  }

  async function updateProfilePhoto(file) {
    if (!user || !file) return;
    try {
      console.log('[updateProfilePhoto] Starting upload, bucket:', storage.app.options.storageBucket);
      const storageRef = ref(storage, `profile-pictures/${user.uid}`);
      await uploadBytes(storageRef, file);
      const photoURL = await getDownloadURL(storageRef);
      console.log('[updateProfilePhoto] Got URL:', photoURL);
      await updateProfile(user, { photoURL });
      await setDoc(doc(db, 'users', user.uid), { photoURL }, { merge: true });
      await auth.currentUser.reload();
      setUser({ ...auth.currentUser });
      return photoURL;
    } catch (err) {
      console.error('[updateProfilePhoto] Error:', err);
      console.error('[updateProfilePhoto] Server response:', err.serverResponse || err.customData);
      throw err;
    }
  }

  async function changePassword(currentPassword, newPassword) {
    if (!user || !user.email) throw new Error('No email associated with this account');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await firebaseUpdatePassword(user, newPassword);
  }

  async function deleteAccount(password) {
    if (!user) return;
    // Reauthenticate if email/password user
    const isEmailUser = user.providerData.some((p) => p.providerId === 'password');
    if (isEmailUser && password) {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
    }
    // Delete all user data from Firestore
    await deleteUserData(user.uid);
    // Delete the Firebase Auth account
    await firebaseDeleteUser(user);
    setUser(null);
    setFavorites([]);
    setFavoriteTeams([]);
    setTokens(0);
    setNeedsUsername(false);
    setDailyBonusClaimed(false);
    setPredictionsResolved(false);
    resolvedRef.current = false;
  }

  const value = {
    user,
    loading,
    favorites,
    favoriteTeams,
    needsUsername,
    tokens,
    signInWithGoogle,
    signInWithEmail,
    signUp,
    setUsername,
    logout,
    toggleFavorite,
    isFavorite,
    toggleFavoriteTeam,
    isTeamFavorite,
    updateProfilePhoto,
    changePassword,
    deleteAccount,
    deductTokens,
    addTokens,
    dailyBonusClaimed,
    dismissDailyBonus,
    predictionsResolved,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
