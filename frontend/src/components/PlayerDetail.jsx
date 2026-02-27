import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Check, Users, Coins } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { savePrediction, updatePrediction, deletePrediction, getCommunityPicks } from '../services/firestoreService';
import api from '../utils/api';
import PlayerCard from './PlayerCard';
import PredictionChart from './PredictionChart';
import LoadingAnimation from './LoadingAnimation';
import PropCards from './PropCards';
import PropOddsTable from './PropOddsTable';
import GameLogTable from './GameLogTable';
import InjuriesTable from './InjuriesTable';
import PropMetricCard from './PropMetricCard';
import PredictionReasoning from './PredictionReasoning';
import {
  calculateCoverProbability,
  calculateExpectedValue,
  calculateBetRating,
  getCoverProbabilityColor,
  getEVColor,
  getBetRatingColor
} from '../utils/propCalculations';


function PlayerDetail() {
  const { playerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isFavorite, toggleFavorite, tokens, deductTokens, addTokens } = useAuth();

  // Get player from navigation state, or use a fallback
  const player = location.state?.player || { id: playerId, name: 'Loading...' };
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [error, setError] = useState(null);
  const [selectedProp, setSelectedProp] = useState('points'); // Default to points prop
  const [loadingPredictions, setLoadingPredictions] = useState({}); // Track loading state for each prop
  const [propPredictions, setPropPredictions] = useState({}); // Store predictions for each prop
  const [showReasoning, setShowReasoning] = useState(false); // Toggle for prediction reasoning
  const [userPredictions, setUserPredictions] = useState({}); // Cache: { propType: prediction }
  const [predictionSaving, setPredictionSaving] = useState(false);
  const [predictionSaved, setPredictionSaved] = useState(false);
  const [communityPicks, setCommunityPicks] = useState({});
  const communityCache = useRef({});
  const [wagerAmount, setWagerAmount] = useState(0);
  const [pendingPick, setPendingPick] = useState(null); // 'over' or 'under' before confirming wager

  // Reset pending pick when switching prop tabs
  useEffect(() => {
    setPendingPick(null);
  }, [selectedProp]);

  useEffect(() => {
    // Scroll to top when player changes
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Reset loading state immediately when player changes
    setLoading(true);
    setError(null);
    setComparisonData(null);
    fetchComparisonData();
  }, [player.id]);

  // Auto-select first available prop if current selection is not available
  // MUST be before any early returns to follow Rules of Hooks
  useEffect(() => {
    if (!comparisonData) return;
    
    if (comparisonData.props && Object.keys(comparisonData.props).length > 0) {
      // Check if current selection is available, if not select first available
      const availableProps = Object.keys(comparisonData.props);
      if (!availableProps.includes(selectedProp)) {
        setSelectedProp(availableProps[0]);
      }
      // Safe: If selectedProp is already in availableProps, we don't call setSelectedProp, so no loop
    } else {
      // If no props available, default to points (even if not available, UI will handle it)
      if (selectedProp !== 'points') {
        setSelectedProp('points');
      }
    }
  }, [comparisonData, selectedProp]); // selectedProp needed to check current selection

  // Load all user predictions for this player's game (single query, cached)
  useEffect(() => {
    if (!user || !comparisonData?.next_game?.date) {
      setUserPredictions({});
      return;
    }
    let cancelled = false;
    async function loadUserPredictions() {
      try {
        // Single where clause to avoid composite index requirement
        const q = query(
          collection(db, 'predictions'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(q);
        if (!cancelled) {
          const byProp = {};
          const pid = String(player.id);
          const gd = comparisonData.next_game.date;
          snap.docs.forEach((d) => {
            const data = { id: d.id, ...d.data() };
            if (data.playerId === pid && data.gameDate === gd) {
              byProp[data.propType] = data;
            }
          });
          setUserPredictions(byProp);
        }
      } catch (err) {
        console.error('[loadUserPredictions] Error loading user predictions:', err);
        if (!cancelled) setUserPredictions({});
      }
    }
    loadUserPredictions();
    return () => { cancelled = true; };
  }, [user, comparisonData?.next_game?.date, player.id]);

  // Load community picks for current prop
  useEffect(() => {
    if (!comparisonData?.next_game?.date || !selectedProp) return;

    const cacheKey = `${player.id}-${selectedProp}-${comparisonData.next_game.date}`;
    if (communityCache.current[cacheKey]) {
      setCommunityPicks((prev) => ({ ...prev, [selectedProp]: communityCache.current[cacheKey] }));
      return;
    }

    let cancelled = false;
    getCommunityPicks(player.id, selectedProp, comparisonData.next_game.date)
      .then((data) => {
        if (!cancelled) {
          communityCache.current[cacheKey] = data;
          setCommunityPicks((prev) => ({ ...prev, [selectedProp]: data }));
        }
      })
      .catch((err) => console.error('[CommunityPicks] Error:', err));

    return () => { cancelled = true; };
  }, [selectedProp, comparisonData?.next_game?.date, player.id]);

  // Lazy load prediction when prop tab is clicked
  useEffect(() => {
    if (!comparisonData || !selectedProp) return;
    
    // Points prediction is already loaded in comparisonData
    if (selectedProp === 'points') {
      return;
    }
    
    // Check if we already have this prediction
    if (propPredictions[selectedProp]) {
      return; // Already loaded
    }
    
    // Check if prediction is already in props (from initial load cache)
    const propData = comparisonData.props?.[selectedProp];
    if (propData?.prediction != null) {
      // Prediction already available, store it with full data including analysis
      // First check if we have the full prediction in comparisonData.predictions
      const fullPrediction = comparisonData.predictions?.[selectedProp];
      if (fullPrediction) {
        setPropPredictions(prev => ({
          ...prev,
          [selectedProp]: fullPrediction
        }));
      } else {
        // Fallback: construct from props data
        setPropPredictions(prev => ({
          ...prev,
          [selectedProp]: {
            [`predicted_${selectedProp}`]: propData.prediction,
            confidence: propData.prediction_confidence,
            error_margin: propData.prediction_error_margin,
            analysis: propData.prediction_analysis || null,
            recommendation: propData.prediction_recommendation || null,
            stats: propData.prediction_stats || null
          }
        }));
      }
      return;
    }
    
    // Need to fetch prediction on demand
    const fetchPropPrediction = async () => {
      setLoadingPredictions(prev => ({ ...prev, [selectedProp]: true }));
      
      try {
        const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        const params = new URLSearchParams();
        params.append('name', playerName);
        
        const url = `/player/${player.id || '0'}/prediction/${selectedProp}?${params.toString()}`;
        const response = await api.get(url);
        
        // Get the actual prediction value - ensure it's a valid number
        const predictedValue = response.data[`predicted_${selectedProp}`] || response.data.predicted_value || response.data.predicted_points;
        
        console.log(`[FetchPrediction] API response for ${selectedProp}:`, {
          responseData: response.data,
          [`predicted_${selectedProp}`]: response.data[`predicted_${selectedProp}`],
          predicted_value: response.data.predicted_value,
          predicted_points: response.data.predicted_points,
          extractedValue: predictedValue
        });
        
        // Validate prediction is a valid number (0 is valid for some props like blocks)
        if (predictedValue == null || isNaN(predictedValue) || predictedValue < 0) {
          console.error(`Invalid prediction value for ${selectedProp}:`, predictedValue);
          // Don't throw error if it's 0 (valid for some props) or if status indicates no line
          if (response.data.status === 'no_line' && predictedValue != null && !isNaN(predictedValue) && predictedValue >= 0) {
            // This is valid - prediction exists but no betting line
            console.log(`[FetchPrediction] Prediction exists but no betting line for ${selectedProp}`);
          } else {
          throw new Error(`Invalid prediction received from API`);
          }
        }
        
        // Update propPredictions first (single source of truth)
        setPropPredictions(prev => ({
          ...prev,
          [selectedProp]: response.data
        }));
        
        // Then update comparisonData props to keep them in sync (include analysis)
        setComparisonData(prev => ({
          ...prev,
          props: {
            ...prev.props,
            [selectedProp]: {
              ...prev.props[selectedProp],
              prediction: predictedValue,
              prediction_confidence: response.data.confidence,
              prediction_error_margin: response.data.error_margin,
              prediction_analysis: response.data.analysis || null,
              prediction_recommendation: response.data.recommendation || null,
              prediction_stats: response.data.stats || null
            }
          },
          // Also update predictions object
          predictions: {
            ...prev.predictions,
            [selectedProp]: response.data
          }
        }));
      } catch (err) {
        console.error(`Error fetching ${selectedProp} prediction:`, err);
        // Don't show error to user, just log it
      } finally {
        setLoadingPredictions(prev => ({ ...prev, [selectedProp]: false }));
      }
    };
    
    fetchPropPrediction();
  }, [selectedProp, comparisonData, player, propPredictions]);

  const fetchComparisonData = async () => {
    setLoading(true);
    setError(null);

    try {
      const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
      console.log(`Fetching comparison data for player: ${playerName}`);
      
      // Build query params with player name (required)
      const params = new URLSearchParams();
      params.append('name', playerName);
      
      // Use any ID (doesn't matter since we use name)
      const url = `/player/${player.id || '0'}/compare?${params.toString()}`;
      const response = await api.get(url);
      console.log('Received comparison data:', response.data);
      
      console.log('Received comparison data:', response.data);
      console.log('Props available:', Object.keys(response.data?.props || {}));
      console.log('Props details:', JSON.stringify(response.data?.props, null, 2));
      
      // Ensure props is always an object
      if (!response.data.props) {
        response.data.props = {};
      }
      
      setComparisonData(response.data);
    } catch (err) {
      console.error('Error fetching comparison data:', err);
      console.error('Error response:', err.response?.data);
      setError(err.response?.data?.error || err.message || 'Failed to load player data');
      // Set empty comparison data so UI doesn't break
      setComparisonData({
        player: `${player.first_name} ${player.last_name}`,
        stats: [],
        prediction: null,
        betting_line: null,
        recommendation: 'N/A',
        props: {} // Ensure props object exists
      });
    } finally {
      setLoading(false);
    }
  };

  const [predictionError, setPredictionError] = useState('');

  // Check if a prediction can still be edited (game hasn't started yet)
  const canEditPrediction = (prediction) => {
    const commenceTime = prediction?.commenceTime || comparisonData?.next_game?.commence_time;
    if (!commenceTime) return true; // If no commence time, allow edit
    const gameStart = new Date(commenceTime).getTime();
    const now = Date.now();
    return now < gameStart - 5 * 60 * 1000; // 5 minutes before game
  };

  const handlePredict = async (pick) => {
    if (!user || !comparisonData?.next_game?.date || predictionSaving) return;
    const propData = comparisonData.props[selectedProp];
    if (!propData?.line) return;

    const existing = userPredictions[selectedProp];

    // If same pick, do nothing
    if (existing && existing.pick === pick) return;

    // If existing prediction, check if game already started
    if (existing && !canEditPrediction(existing)) {
      setPredictionError('Game has already started — prediction locked.');
      return;
    }

    setPredictionSaving(true);
    setPredictionError('');
    try {
      const playerName = comparisonData.player || `${player.first_name || ''} ${player.last_name || ''}`.trim();

      // Get odds for the selected pick
      const oddsForPick = pick === 'over' ? (propData.over_odds || -110) : (propData.under_odds || -110);
      const actualWager = Math.min(wagerAmount, tokens);

      if (existing?.id) {
        // Update existing prediction
        await updatePrediction(existing.id, { pick, line: propData.line });
        setUserPredictions((prev) => ({
          ...prev,
          [selectedProp]: { ...prev[selectedProp], pick, line: propData.line },
        }));
      } else {
        // Create new prediction
        const docRef = await savePrediction(user.uid, {
          userName: user.displayName || user.email?.split('@')[0] || 'User',
          playerId: String(player.id),
          playerName,
          propType: selectedProp,
          line: propData.line,
          pick,
          gameDate: comparisonData.next_game.date,
          opponent: comparisonData.next_game.opponent || '',
          commenceTime: comparisonData.next_game.commence_time || null,
          wager: actualWager,
          oddsUsed: oddsForPick,
        });
        setUserPredictions((prev) => ({
          ...prev,
          [selectedProp]: { id: docRef.id, pick, line: propData.line, wager: actualWager, oddsUsed: oddsForPick, commenceTime: comparisonData.next_game.commence_time || null },
        }));
        // Deduct tokens immediately (optimistic)
        if (actualWager > 0) {
          deductTokens(actualWager);
        }
      }
      // Optimistic community update
      setCommunityPicks((prev) => {
        const current = prev[selectedProp] || { overCount: 0, underCount: 0, total: 0 };
        let newOver = current.overCount;
        let newUnder = current.underCount;
        if (!existing?.id) {
          if (pick === 'over') newOver++; else newUnder++;
        } else {
          if (existing.pick === 'over') { newOver--; newUnder++; } else { newUnder--; newOver++; }
        }
        const newTotal = newOver + newUnder;
        const updated = { ...current, overCount: newOver, underCount: newUnder, total: newTotal, overPercent: newTotal > 0 ? Math.round((newOver / newTotal) * 100) : 50, underPercent: newTotal > 0 ? Math.round((newUnder / newTotal) * 100) : 50 };
        const cacheKey = `${player.id}-${selectedProp}-${comparisonData.next_game.date}`;
        communityCache.current[cacheKey] = updated;
        return { ...prev, [selectedProp]: updated };
      });

      setPredictionSaved(true);
      setTimeout(() => setPredictionSaved(false), 3000);
    } catch (err) {
      console.error('Error saving prediction:', err);
      setPredictionError(err.message || 'Failed to save prediction');
    } finally {
      setPredictionSaving(false);
    }
  };

  const handleDeletePrediction = async () => {
    const existing = userPredictions[selectedProp];
    if (!existing?.id || predictionSaving) return;
    if (!canEditPrediction(existing)) {
      setPredictionError('Game has already started — prediction locked.');
      return;
    }
    setPredictionSaving(true);
    setPredictionError('');
    try {
      await deletePrediction(existing.id);
      // Refund wager tokens
      if (existing.wager > 0) {
        addTokens(existing.wager);
      }
      setUserPredictions((prev) => {
        const updated = { ...prev };
        delete updated[selectedProp];
        return updated;
      });
      // Optimistic community decrement
      setCommunityPicks((prev) => {
        const current = prev[selectedProp] || { overCount: 0, underCount: 0, total: 0 };
        let newOver = current.overCount;
        let newUnder = current.underCount;
        if (existing.pick === 'over') newOver = Math.max(0, newOver - 1);
        else newUnder = Math.max(0, newUnder - 1);
        const newTotal = newOver + newUnder;
        const updated = { ...current, overCount: newOver, underCount: newUnder, total: newTotal, overPercent: newTotal > 0 ? Math.round((newOver / newTotal) * 100) : 50, underPercent: newTotal > 0 ? Math.round((newUnder / newTotal) * 100) : 50 };
        const cacheKey = `${player.id}-${selectedProp}-${comparisonData.next_game.date}`;
        communityCache.current[cacheKey] = updated;
        return { ...prev, [selectedProp]: updated };
      });
    } catch (err) {
      console.error('Error deleting prediction:', err);
      setPredictionError(err.message || 'Failed to delete prediction');
    } finally {
      setPredictionSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full">
        {/* Breadcrumb Navigation Skeleton */}
        <div className="max-w-7xl mx-auto px-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => navigate(-1)}
              className="hover:text-white transition-colors text-gray-400"
            >
              ← Back
            </button>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400">Prop Bet Analyzer</span>
            <span className="text-gray-600">/</span>
            <div className="h-4 w-32 bg-gray-700 rounded animate-pulse"></div>
          </div>
        </div>

        {/* Banner Skeleton */}
        <div className="w-screen relative" style={{ left: '50%', right: '50%', marginLeft: '-50vw', marginRight: '-50vw' }}>
          <div className="bg-gray-800 shadow-xl p-6 mb-6 border-b border-t border-gray-700">
            <div className="max-w-7xl mx-auto px-4">
              <div className="flex items-start gap-8">
                {/* Player Image Skeleton */}
                <div className="w-40 h-40 rounded-full bg-gray-700 animate-pulse flex-shrink-0"></div>
                
                {/* Player Info Skeleton */}
                <div className="flex-1 space-y-3">
                  <div className="h-4 w-32 bg-gray-700 rounded animate-pulse"></div>
                  <div className="h-8 w-48 bg-gray-700 rounded animate-pulse"></div>
                  <div className="h-4 w-40 bg-gray-700 rounded animate-pulse"></div>
                </div>
                
                {/* Matchup Skeleton */}
                <div className="flex items-center gap-8 flex-shrink-0">
                  <div className="text-center space-y-2">
                    <div className="w-20 h-20 bg-gray-700 rounded animate-pulse mx-auto"></div>
                    <div className="h-4 w-24 bg-gray-700 rounded animate-pulse mx-auto"></div>
                    <div className="h-3 w-16 bg-gray-700 rounded animate-pulse mx-auto"></div>
                  </div>
                  <div className="text-center space-y-2">
                    <div className="h-5 w-32 bg-gray-700 rounded animate-pulse"></div>
                    <div className="h-3 w-24 bg-gray-700 rounded animate-pulse"></div>
                  </div>
                  <div className="text-center space-y-2">
                    <div className="w-20 h-20 bg-gray-700 rounded animate-pulse mx-auto"></div>
                    <div className="h-4 w-24 bg-gray-700 rounded animate-pulse mx-auto"></div>
                    <div className="h-3 w-16 bg-gray-700 rounded animate-pulse mx-auto"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Prop Cards Skeleton */}
        <div className="max-w-7xl mx-auto px-4 mb-6">
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-24 w-32 bg-gray-800 rounded-xl border border-gray-700 animate-pulse"
              >
                <div className="p-3 h-full flex flex-col justify-between">
                  <div className="h-4 w-20 bg-gray-700 rounded"></div>
                  <div className="h-6 w-16 bg-gray-700 rounded"></div>
                  <div className="h-3 w-24 bg-gray-700 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content Skeleton */}
        <div className="max-w-7xl mx-auto px-4">
          <div className="space-y-6 mb-6">
            {/* Top Section: 6 Metric Cards Skeleton (including Season Prop Record) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
                  <div className="h-4 w-24 bg-gray-700 rounded animate-pulse mb-3"></div>
                  <div className="h-10 w-32 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-20 bg-gray-700 rounded animate-pulse"></div>
                </div>
              ))}
            </div>

            {/* Prediction Reasoning Toggle Skeleton */}
            <div className="h-12 bg-gray-800 rounded-lg border border-gray-700 animate-pulse"></div>

            {/* Chart Skeleton */}
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="h-7 w-32 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-4 w-64 bg-gray-700 rounded animate-pulse"></div>
                </div>
                <div className="flex gap-2">
                  {['L5', 'L10', 'L15', 'H2H', 'Season', '2025', '2024'].map((f) => (
                    <div key={f} className="h-8 w-12 bg-gray-700 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
              <div className="h-96 bg-gray-700/50 rounded-lg animate-pulse relative overflow-hidden">
                {/* Simulated chart bars */}
                <div className="absolute bottom-0 left-0 right-0 flex items-end justify-around px-4 pb-4 gap-2">
                  {[20, 35, 45, 30, 50, 40, 55, 35, 45, 50, 30, 40, 45, 35, 50].map((height, i) => (
                    <div
                      key={i}
                      className="w-6 bg-gray-600 rounded-t animate-pulse"
                      style={{ height: `${height}%`, animationDelay: `${i * 50}ms` }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Prop Odds Table Skeleton */}
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="h-7 w-32 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-4 w-40 bg-gray-700 rounded animate-pulse"></div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-[150px_140px_repeat(6,140px)] gap-2">
                  {/* Header row */}
                  <div className="h-8 bg-gray-700 rounded animate-pulse"></div>
                  <div className="h-8 bg-gray-700 rounded animate-pulse"></div>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-8 bg-gray-700 rounded animate-pulse"></div>
                  ))}
                  {/* Over row */}
                  <div className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  <div className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  ))}
                  {/* Under row */}
                  <div className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  <div className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-12 bg-gray-700/50 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Game Log Skeleton */}
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className="h-7 w-40 bg-gray-700 rounded animate-pulse"></div>
                <div className="flex gap-2">
                  <div className="h-8 w-24 bg-gray-700 rounded animate-pulse"></div>
                  <div className="h-8 w-24 bg-gray-700 rounded animate-pulse"></div>
                </div>
              </div>
              {/* Table header skeleton */}
              <div className="grid grid-cols-8 gap-2 mb-2 pb-2 border-b border-gray-700">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="h-4 bg-gray-700 rounded animate-pulse"></div>
                ))}
              </div>
              {/* Table rows skeleton */}
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                  <div key={i} className="grid grid-cols-8 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
                      <div key={j} className="h-8 bg-gray-700/50 rounded animate-pulse"></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Injuries Table Skeleton */}
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
              <div className="h-7 w-32 bg-gray-700 rounded animate-pulse mb-4"></div>
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-gray-700/50 rounded animate-pulse"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          ← Back
        </button>
        <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
          <div className="text-red-400 text-center">
            <p className="text-xl font-semibold">Error</p>
            <p className="mt-2 text-gray-300">{error}</p>
            <button
              onClick={fetchComparisonData}
              className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!comparisonData) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
          <p className="text-gray-400 text-center">Loading player data...</p>
        </div>
      </div>
    );
  }


  return (
    <div className="w-full">
      {/* Breadcrumb Navigation */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="max-w-7xl mx-auto px-4 mb-4"
      >
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <motion.button
            onClick={() => navigate(-1)}
            whileHover={{ x: -4, scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="hover:text-white transition-colors flex items-center gap-1 text-gray-400"
          >
            <motion.span
              animate={{ x: [0, -4, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
            >
              ←
            </motion.span>
            Back
          </motion.button>
          <span>›</span>
          <span className="text-gray-300 font-medium">{comparisonData?.player || `${player.first_name} ${player.last_name}`}</span>
        </div>
      </motion.div>

      {/* Player Header */}
      <div className="w-screen relative" style={{ left: '50%', right: '50%', marginLeft: '-50vw', marginRight: '-50vw' }}>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-[#0f1923] border-b border-gray-800 mb-6 overflow-hidden"
          style={{ minHeight: '160px' }}
        >
          <div className="max-w-7xl mx-auto flex items-stretch" style={{ minHeight: '160px' }}>

            {/* Player Image — diagonal clip with team-color background */}
            {comparisonData?.player_image && (
              <div
                className="relative flex-shrink-0 overflow-hidden"
                style={{ width: '230px' }}
              >
                {comparisonData.player_team_logo && (
                  <img
                    src={comparisonData.player_team_logo}
                    alt=""
                    className="absolute -right-4 bottom-0 h-full w-auto object-contain pointer-events-none"
                  />
                )}
                <img
                  src={comparisonData.player_image}
                  alt={comparisonData.player || 'Player'}
                  className="relative z-10 h-full w-full object-cover object-top"
                  onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                />
              </div>
            )}

            {/* Player Info */}
            <div className="flex-1 flex flex-col justify-center px-8 py-5">
              <div className="flex items-center gap-2 mb-1.5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  {comparisonData?.player || `${player.first_name} ${player.last_name}`}
                </h1>
                {user && (
                  <button
                    onClick={() => {
                      const name = comparisonData?.player || `${player.first_name} ${player.last_name}`;
                      toggleFavorite(playerId, name);
                    }}
                    className="p-1 rounded-lg hover:bg-gray-700/50 transition-colors"
                    title={isFavorite(playerId) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      size={20}
                      className={isFavorite(playerId) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500 hover:text-yellow-500'}
                    />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap mb-3">
                {(comparisonData?.position && comparisonData.position !== 'N/A') && (
                  <span className="px-2 py-0.5 bg-slate-700/80 text-gray-300 rounded text-xs font-semibold border border-slate-600/50">{comparisonData.position}</span>
                )}
                {comparisonData?.player_team && (
                  <span className="text-gray-300 font-medium">{comparisonData.player_team}</span>
                )}
                {comparisonData?.next_game && (
                  <>
                    <span className="text-gray-600">{comparisonData.next_game.isHome ? 'vs' : '@'}</span>
                    <span className="text-gray-300 font-medium">{comparisonData.next_game.opponent || 'TBD'}</span>
                  </>
                )}
              </div>
              {/* Season Averages — current season only */}
              {comparisonData?.stats?.length > 0 && (() => {
                // Filter to current season only (use the most recent game's season tag)
                const currentSeason = comparisonData.stats[0]?.season;
                const games = currentSeason
                  ? comparisonData.stats.filter(g => g.season === currentSeason)
                  : comparisonData.stats;
                const count = games.length || 1;
                const ppg = (games.reduce((s, g) => s + (g.pts || 0), 0) / count).toFixed(1);
                const rpg = (games.reduce((s, g) => s + (g.reb || 0), 0) / count).toFixed(1);
                const apg = (games.reduce((s, g) => s + (g.ast || 0), 0) / count).toFixed(1);
                return (
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <span className="text-white text-base font-bold">{ppg}</span>
                      <span className="text-gray-500 text-[10px] font-semibold uppercase ml-1">PPG</span>
                    </div>
                    <div className="w-px h-4 bg-gray-700" />
                    <div className="text-center">
                      <span className="text-white text-base font-bold">{rpg}</span>
                      <span className="text-gray-500 text-[10px] font-semibold uppercase ml-1">RPG</span>
                    </div>
                    <div className="w-px h-4 bg-gray-700" />
                    <div className="text-center">
                      <span className="text-white text-base font-bold">{apg}</span>
                      <span className="text-gray-500 text-[10px] font-semibold uppercase ml-1">APG</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Divider */}
            {comparisonData?.next_game && (
              <div className="w-px bg-gray-700/50 flex-shrink-0 my-6" />
            )}

            {/* Matchup */}
            {comparisonData?.next_game && (() => {
              const nextGame = comparisonData.next_game;
              const opponent = nextGame?.opponent_name || nextGame?.opponent || null;

              if (comparisonData.player && comparisonData.player.toLowerCase().includes('nickeil')) {
                console.log('🔍 Debug next_game for Nickeil:', {
                  next_game: nextGame,
                  opponent: nextGame?.opponent,
                  opponent_name: nextGame?.opponent_name,
                  opponent_logo: nextGame?.opponent_logo,
                  opponent_record: nextGame?.opponent_record,
                  full_comparisonData: comparisonData
                });
              }

              const dateStr = nextGame.date ? (() => {
                try {
                  const d = new Date(nextGame.date);
                  if (isNaN(d.getTime())) return nextGame.date;
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
                } catch { return nextGame.date; }
              })() : 'TBD';

              return (
                <div className="flex items-center gap-5 px-8 py-5 flex-shrink-0">
                  {/* Home team */}
                  <div className="flex flex-col items-center gap-1 text-center" style={{ minWidth: '72px' }}>
                    {comparisonData.player_team_logo && (
                      <img src={comparisonData.player_team_logo} alt="" className="w-11 h-11 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                    )}
                    <span className="text-xs font-bold text-white">{comparisonData.player_team_name || 'TBD'}</span>
                    {comparisonData.player_team_record && <span className="text-xs text-gray-500">{comparisonData.player_team_record}</span>}
                  </div>

                  {/* Date & Time */}
                  <div className="text-center px-2">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{dateStr}</div>
                    {nextGame.time && nextGame.time !== 'TBD' && (
                      <div className="text-xs text-gray-500 mt-0.5">{nextGame.time}</div>
                    )}
                  </div>

                  {/* Away team */}
                  {opponent && (
                    <div className="flex flex-col items-center gap-1 text-center" style={{ minWidth: '72px' }}>
                      {nextGame.opponent_logo && (
                        <img src={nextGame.opponent_logo} alt="" className="w-11 h-11 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                      )}
                      <span className="text-xs font-bold text-white">{opponent}</span>
                      {nextGame.opponent_record && <span className="text-xs text-gray-500">{nextGame.opponent_record}</span>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </motion.div>
      </div>

      {/* Prop Cards - Display all available props */}
      <div className="max-w-7xl mx-auto px-4">
        {(() => {
          const props = comparisonData?.props || {};
          const propKeys = Object.keys(props);
          console.log('🔍 PlayerDetail - Rendering props:', {
            hasProps: propKeys.length > 0,
            propKeys: propKeys,
            propsData: props,
            selectedProp: selectedProp
          });
          
          // Log each prop to see why it might be filtered
          propKeys.forEach(key => {
            const prop = props[key];
            console.log(`  - ${key}:`, {
              hasData: !!prop,
              line: prop?.line,
              lineType: typeof prop?.line,
              over_odds: prop?.over_odds,
              under_odds: prop?.under_odds,
              willDisplay: prop && prop.line != null
            });
          });
          
          return propKeys.length > 0 ? (
            <PropCards 
              props={props}
              selectedProp={selectedProp}
              onSelectProp={setSelectedProp}
            />
          ) : (
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-6 border border-gray-700">
              <p className="text-gray-400 text-center">No prop bets available for this player</p>
              <p className="text-gray-500 text-center text-xs mt-2">Props object: {JSON.stringify(props)}</p>
            </div>
          );
        })()}
      </div>

      {/* Main Content Grid */}
      <div className="max-w-7xl mx-auto px-4">
      <div className="space-y-6 mb-6">
        {/* Main Content: Full Width */}
        <div className="space-y-6">
          {/* BettingPros-Style Prop Analysis Section */}
          {comparisonData?.props?.[selectedProp] ? (
            <>
              {/* Top Section: Metric Cards + Season Prop Record */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="bg-[#1a1f2e] rounded-lg shadow-xl border border-gray-700 mb-6 relative"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                {(() => {
                  const propData = comparisonData.props[selectedProp];
                  const line = propData?.line;
                  
                  // Get prediction
                  let prediction = null;
                  if (selectedProp === 'points') {
                    prediction = comparisonData.prediction;
                  } else {
                    const pred = propPredictions[selectedProp];
                    if (pred) {
                      prediction = pred[`predicted_${selectedProp}`] || pred.predicted_value || pred.predicted_points;
                      console.log(`[Projection] Found prediction in propPredictions for ${selectedProp}:`, {
                        pred,
                        [`predicted_${selectedProp}`]: pred[`predicted_${selectedProp}`],
                        predicted_value: pred.predicted_value,
                        predicted_points: pred.predicted_points,
                        final: prediction
                      });
                    } else if (propData?.prediction != null) {
                      prediction = propData.prediction;
                      console.log(`[Projection] Found prediction in propData for ${selectedProp}:`, prediction);
                    } else {
                      console.log(`[Projection] No prediction found for ${selectedProp}:`, {
                        hasPropPredictions: !!propPredictions[selectedProp],
                        hasPropData: !!propData,
                        propDataPrediction: propData?.prediction,
                        loading: loadingPredictions[selectedProp]
                      });
                    }
                  }
                  
                  const recommendation = (prediction != null && line != null) 
                    ? (prediction > line ? 'OVER' : prediction < line ? 'UNDER' : 'PUSH')
                    : null;
                  
                  // Get prop labels
                  const propLabels = {
                    points: 'points',
                    assists: 'assists',
                    rebounds: 'rebounds',
                    threes: '3Pts Made',
                    steals: 'steals',
                    blocks: 'blocks',
                    pra: 'points + rebounds + assists',
                    pr: 'points + rebounds',
                    pa: 'points + assists',
                    ra: 'rebounds + assists',
                    points_rebounds: 'points + rebounds',
                    points_assists: 'points + assists',
                    rebounds_assists: 'rebounds + assists',
                    points_rebounds_assists: 'points + rebounds + assists'
                  };
                  const propLabel = propLabels[selectedProp] || selectedProp.replace(/_/g, ' ');
                  
                  // Calculate cover probability - ALWAYS calculate, use defaults if needed
                  const errorMargin = comparisonData.error_margin || 
                    (propPredictions[selectedProp]?.error_margin) ||
                    (propData?.prediction_error_margin) ||
                    Math.max(2, Math.abs((prediction || 0) - (line || 0)) * 0.3);
                  
                  // Always calculate cover probability, even if prediction/line are missing (use defaults)
                  const coverProbability = (prediction != null && line != null)
                    ? calculateCoverProbability(prediction, line, errorMargin, recommendation === 'OVER')
                    : 50.0; // Default to 50% if no data
                  
                  // Get odds for EV calculation (use best odds from all_bookmakers or single bookmaker)
                  // IMPORTANT: Only use odds from bookmakers with the SAME line as consensus
                  const bestOverOdds = propData?.all_bookmakers?.length > 0
                    ? Math.max(...propData.all_bookmakers
                        .filter(bm => bm.line === line) // Only same line
                        .map(bm => bm.over_odds || -110)
                        .filter(o => o != null))
                    : propData?.over_odds;

                  const bestUnderOdds = propData?.all_bookmakers?.length > 0
                    ? Math.max(...propData.all_bookmakers
                        .filter(bm => bm.line === line) // Only same line
                        .map(bm => bm.under_odds || -110)
                        .filter(o => o != null))
                    : propData?.under_odds;
                  
                  const oddsToUse = recommendation === 'OVER' ? bestOverOdds : bestUnderOdds;
                  
                  // Only calculate EV and bet rating if we have valid prediction data
                  const hasPrediction = prediction != null && !isNaN(prediction) && !loadingPredictions[selectedProp];
                  
                  // Calculate EV - ONLY if we have prediction
                  const oddsForEV = oddsToUse != null ? oddsToUse : -110; // Default to -110 if no odds
                  const ev = (hasPrediction && coverProbability != null)
                    ? calculateExpectedValue(coverProbability, oddsForEV)
                    : null; // null instead of 0 when no data
                  
                  // Calculate bet rating - ONLY if we have prediction
                  const predictionDiff = (hasPrediction && line != null) ? prediction - line : null;
                  const confidence = hasPrediction 
                    ? (comparisonData.confidence || 
                       propPredictions[selectedProp]?.confidence ||
                       propData?.prediction_confidence ||
                       50)
                    : null;
                  
                  // Only calculate bet rating if we have all necessary data
                  const betRating = (hasPrediction && ev != null && coverProbability != null && predictionDiff != null && confidence != null)
                    ? calculateBetRating(ev, coverProbability, predictionDiff, confidence)
                    : null;
                  
                  // Calculate season prop record
                  let seasonRecord = null;
                  let seasonRecordDisplay = 'N/A';
                  if (line && comparisonData?.stats && comparisonData.stats.length > 0) {
                    const getStatValue = (game) => {
                      switch (selectedProp) {
                        case 'points': return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
                        case 'assists': return typeof game.assists === 'number' ? game.assists : parseFloat(game.assists) || 0;
                        case 'rebounds': return typeof game.rebounds === 'number' ? game.rebounds : parseFloat(game.rebounds) || 0;
                        case 'steals': return typeof game.steals === 'number' ? game.steals : parseFloat(game.steals) || 0;
                        case 'blocks': return typeof game.blocks === 'number' ? game.blocks : parseFloat(game.blocks) || 0;
                        case 'threes': return typeof game.threes_made === 'number' ? game.threes_made : (typeof game.threes === 'number' ? game.threes : parseFloat(game.threes) || 0);
                        case 'pra':
                        case 'points_rebounds_assists': return (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
                        case 'pr':
                        case 'points_rebounds': return (game.points || 0) + (game.rebounds || 0);
                        case 'pa':
                        case 'points_assists': return (game.points || 0) + (game.assists || 0);
                        case 'ra':
                        case 'rebounds_assists': return (game.rebounds || 0) + (game.assists || 0);
                        default: return typeof game.points === 'number' ? game.points : parseFloat(game.points) || 0;
                      }
                    };
                    
                    const currentSeasonGames = comparisonData.stats.filter(game => {
                      if (game.season) {
                        return game.season === '2025-26' || game.season.includes('2025-26');
                      }
                      try {
                        const date = new Date(game.date);
                        return date.getFullYear() === 2025;
                      } catch {
                        return false;
                      }
                    });
                    
                    let overCount = 0;
                    let underCount = 0;
                    currentSeasonGames.forEach(game => {
                      const value = getStatValue(game);
                      if (value >= line) overCount++;
                      else underCount++;
                    });
                    
                    if (overCount + underCount > 0) {
                      seasonRecord = `${overCount}-${underCount}`;
                      seasonRecordDisplay = `${overCount}-${underCount} (Over - Under)`;
                    }
                  }
                  
                  return (
                    <>
                      {/* Consensus Line */}
                      <PropMetricCard
                        title="Consensus Line"
                        value={line != null ? `${line.toFixed(1)} ${propLabel} (o/u)` : 'N/A'}
                        color="text-white"
                        valueSize="text-base sm:text-lg lg:text-xl"
                        index={0}
                      />

                      {/* Projection */}
                      <PropMetricCard
                        title="Projection"
                        value={prediction != null
                          ? `${prediction.toFixed(1)} ${propLabel} ${recommendation ? `(${recommendation.toLowerCase()})` : ''}`
                          : loadingPredictions[selectedProp] ? 'Loading...' : 'N/A'}
                        color={recommendation === 'OVER' ? 'text-green-400' : recommendation === 'UNDER' ? 'text-red-400' : 'text-yellow-400'}
                        valueSize="text-base sm:text-lg lg:text-xl"
                        index={1}
                      />
                      
                      {/* Cover Probability */}
                      <PropMetricCard
                        title="Cover Probability"
                        value={hasPrediction && coverProbability != null
                          ? `${coverProbability.toFixed(0)}%`
                          : loadingPredictions[selectedProp] ? 'Loading...' : 'N/A'}
                        color={hasPrediction && coverProbability != null ? getCoverProbabilityColor(coverProbability) : 'text-gray-400'}
                        progressBar={hasPrediction && coverProbability != null ? coverProbability : null}
                        infoTooltip="The probability that the bet will cover based on our model's prediction and historical performance."
                        infoTooltipLabel="Cover Probability"
                        valueSize="text-2xl sm:text-3xl"
                        index={2}
                      />

                      {/* Expected Value */}
                      <PropMetricCard
                        title="Expected Value"
                        value={ev != null
                          ? `${ev > 0 ? '+' : ''}${ev.toFixed(1)}%`
                          : loadingPredictions[selectedProp] ? 'Loading...' : 'N/A'}
                        color={ev != null ? getEVColor(ev) : 'text-gray-400'}
                        infoTooltip="The expected value of the bet calculated from cover probability and current odds. Positive EV indicates a profitable bet over time."
                        infoTooltipLabel="Expected Value"
                        valueSize="text-2xl sm:text-3xl"
                        index={3}
                      />
                      
                      {/* Bet Rating */}
                      <PropMetricCard
                        title="Bet Rating"
                        customValue={betRating != null ? (
                          <span className={`inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xl sm:text-2xl font-bold ${getBetRatingColor(betRating)} bg-gray-700 border-2 ${getBetRatingColor(betRating).replace('text-', 'border-')}`}>
                            {betRating}
                          </span>
                        ) : null}
                        value={betRating == null ? (loadingPredictions[selectedProp] ? 'Loading...' : 'N/A') : undefined}
                        color={betRating != null ? getBetRatingColor(betRating) : 'text-gray-400'}
                        infoTooltip="Overall bet rating (A+ to F) based on expected value, model confidence, and prediction edge over the betting line."
                        infoTooltipLabel="Bet Rating"
                        index={4}
                      />

                      {/* Season Prop Record */}
                      <PropMetricCard
                        title="Season Prop Record"
                        value={seasonRecordDisplay}
                        color="text-white"
                        valueSize="text-base sm:text-lg lg:text-xl"
                        index={5}
                      />
                    </>
                  );
                })()}
                </div>
              </motion.div>

              {/* Social Prediction Poll */}
              {user && comparisonData?.next_game?.date && comparisonData?.props?.[selectedProp]?.line && (() => {
                const propLine = parseFloat(comparisonData.props[selectedProp].line).toFixed(1);
                const userPick = userPredictions[selectedProp];
                const community = communityPicks[selectedProp] || { overCount: 0, underCount: 0, total: 0, overPercent: 50, underPercent: 50 };
                const hasCommunityData = community.total > 0;
                const userAgreesWithMajority = userPick && (
                  (userPick.pick === 'over' && community.overPercent >= 50) ||
                  (userPick.pick === 'under' && community.underPercent > 50)
                );

                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="bg-[#1a2332] rounded-xl border border-gray-700/50 mb-4 overflow-hidden"
                  >
                    {/* Header */}
                    <div className="px-5 pt-4 pb-3 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                          <Users size={16} className="text-yellow-500" />
                          Make Your Prediction
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {comparisonData.next_game.opponent ? `vs ${comparisonData.next_game.opponent} · ` : ''}{comparisonData.next_game.date}
                        </p>
                      </div>
                      {hasCommunityData && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700/50 border border-gray-600/50"
                        >
                          <Users size={12} className="text-gray-400" />
                          <span className="text-xs font-medium text-gray-300">
                            {community.total} pick{community.total !== 1 ? 's' : ''}
                          </span>
                        </motion.div>
                      )}
                    </div>

                    <div className="px-5 pb-4">
                      {/* Line Display */}
                      <div className="text-center mb-4">
                        <span className="text-2xl font-bold text-white">{propLine}</span>
                        <span className="text-sm text-gray-400 ml-2">{selectedProp.replace(/_/g, ' ')}</span>
                      </div>

                      {/* OVER / UNDER Buttons */}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <motion.button
                          onClick={() => {
                            if (userPick) { handlePredict('over'); }
                            else { setPendingPick(pendingPick === 'over' ? null : 'over'); }
                          }}
                          disabled={predictionSaving}
                          whileHover={{ scale: 1.02, y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className={`relative py-4 px-4 rounded-xl text-center font-bold transition-all overflow-hidden ${
                            userPick?.pick === 'over' || pendingPick === 'over'
                              ? 'bg-green-500/20 border-2 border-green-500 text-green-400 shadow-lg shadow-green-500/20'
                              : 'bg-gray-700/50 border-2 border-gray-600/50 text-gray-300 hover:border-green-500/50 hover:bg-green-500/10'
                          } disabled:opacity-50`}
                        >
                          <div className="text-lg font-bold">OVER</div>
                          <div className="text-xs opacity-70 mt-0.5">{propLine}</div>
                          {userPick?.pick === 'over' && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-1">
                              <Check size={16} className="mx-auto text-green-400" />
                            </motion.div>
                          )}
                        </motion.button>

                        <motion.button
                          onClick={() => {
                            if (userPick) { handlePredict('under'); }
                            else { setPendingPick(pendingPick === 'under' ? null : 'under'); }
                          }}
                          disabled={predictionSaving}
                          whileHover={{ scale: 1.02, y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className={`relative py-4 px-4 rounded-xl text-center font-bold transition-all overflow-hidden ${
                            userPick?.pick === 'under' || pendingPick === 'under'
                              ? 'bg-red-500/20 border-2 border-red-500 text-red-400 shadow-lg shadow-red-500/20'
                              : 'bg-gray-700/50 border-2 border-gray-600/50 text-gray-300 hover:border-red-500/50 hover:bg-red-500/10'
                          } disabled:opacity-50`}
                        >
                          <div className="text-lg font-bold">UNDER</div>
                          <div className="text-xs opacity-70 mt-0.5">{propLine}</div>
                          {userPick?.pick === 'under' && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-1">
                              <Check size={16} className="mx-auto text-red-400" />
                            </motion.div>
                          )}
                        </motion.button>
                      </div>

                      {/* Wager + Confirm (after selecting a side) */}
                      <AnimatePresence>
                        {!userPick && pendingPick && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="flex flex-col items-center gap-1.5 mb-3">
                              <div className="flex items-center justify-center gap-2.5">
                                {tokens > 0 && (
                                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-700/60 border border-gray-600/50">
                                    <Coins size={13} className="text-yellow-500" />
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={wagerAmount === 0 ? '' : String(wagerAmount)}
                                      onChange={(e) => {
                                        const raw = e.target.value.replace(/\D/g, '');
                                        if (raw === '') { setWagerAmount(0); return; }
                                        setWagerAmount(Math.min(parseInt(raw, 10), tokens));
                                      }}
                                      placeholder="0"
                                      className="w-12 bg-transparent text-yellow-400 text-sm font-bold text-center focus:outline-none"
                                    />
                                    <span className="text-[11px] text-gray-500 font-medium">/ {tokens}</span>
                                  </div>
                                )}
                                {(() => {
                                  const odds = pendingPick === 'over'
                                    ? (comparisonData.props[selectedProp]?.over_odds || -110)
                                    : (comparisonData.props[selectedProp]?.under_odds || -110);
                                  if (wagerAmount > 0) {
                                    const profit = odds > 0 ? wagerAmount * (odds / 100) : wagerAmount * (100 / Math.abs(odds));
                                    return (
                                      <span className="text-[11px] text-gray-500">
                                        win <span className="text-green-400 font-semibold">+{Math.round(wagerAmount + profit)}</span>
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="text-[11px] text-gray-500">
                                      win <span className="text-green-400 font-semibold">+10</span>
                                    </span>
                                  );
                                })()}
                                <motion.button
                                  onClick={() => { handlePredict(pendingPick); setPendingPick(null); }}
                                  disabled={predictionSaving}
                                  whileTap={{ scale: 0.95 }}
                                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                                    pendingPick === 'over'
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-red-500 text-white hover:bg-red-600'
                                  }`}
                                >
                                  Confirm
                                </motion.button>
                              </div>
                              {tokens > 0 && wagerAmount === 0 && (
                                <p className="text-[10px] text-gray-600">Wager is optional — leave empty to pick for free</p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Community Split Bar */}
                      <AnimatePresence>
                        {hasCommunityData && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <div className="relative h-8 rounded-lg overflow-hidden flex mb-2">
                              {community.overPercent > 0 && (
                                <motion.div
                                  initial={{ width: '50%' }}
                                  animate={{ width: `${community.overPercent}%` }}
                                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                  className="bg-green-500/30 flex items-center justify-start px-3"
                                >
                                  <span className="text-xs font-bold text-green-400 whitespace-nowrap">
                                    {community.overPercent}% Over
                                  </span>
                                </motion.div>
                              )}
                              {community.underPercent > 0 && (
                                <motion.div
                                  initial={{ width: '50%' }}
                                  animate={{ width: `${community.underPercent}%` }}
                                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                  className="bg-red-500/30 flex items-center justify-end px-3"
                                >
                                  <span className="text-xs font-bold text-red-400 whitespace-nowrap">
                                    {community.underPercent}% Under
                                  </span>
                                </motion.div>
                              )}
                            </div>

                            {userPick && (
                              <motion.p
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-xs text-gray-400 text-center"
                              >
                                {userAgreesWithMajority ? "You're with the majority" : "You're going against the crowd"}
                                {' · '}
                                <span className={userPick.pick === 'over' ? 'text-green-400' : 'text-red-400'}>
                                  {userPick.pick === 'over' ? community.overCount - 1 : community.underCount - 1}
                                </span>
                                {' '}other{(userPick.pick === 'over' ? community.overCount - 1 : community.underCount - 1) !== 1 ? 's' : ''} picked {userPick.pick.toUpperCase()}
                              </motion.p>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Undo + Saved */}
                      <AnimatePresence>
                        {userPick && canEditPrediction(userPick) && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-gray-700/50"
                          >
                            <button
                              onClick={handleDeletePrediction}
                              disabled={predictionSaving}
                              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 transition-colors disabled:opacity-50"
                            >
                              Undo Pick
                            </button>
                            {predictionSaved && (
                              <motion.span
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-1 text-xs text-green-400"
                              >
                                <Check size={14} /> Saved
                              </motion.span>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {predictionError && (
                        <p className="text-red-400 text-xs mt-2 text-center">{predictionError}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })()}

              {/* Prediction Reasoning Toggle */}
              {(() => {
                const propData = comparisonData.props[selectedProp];
                const prediction = selectedProp === 'points' 
                  ? comparisonData.prediction 
                  : (propData?.prediction != null 
                      ? propData.prediction 
                      : (propPredictions[selectedProp] 
                          ? (propPredictions[selectedProp][`predicted_${selectedProp}`] || propPredictions[selectedProp].predicted_value || propPredictions[selectedProp].predicted_points)
                          : null));
                
                if (prediction == null) return null;
                
                return (
                  <div className="mb-6">
                    <button
                      onClick={() => setShowReasoning(!showReasoning)}
                      className="w-full p-3 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-white font-medium flex items-center justify-center gap-2"
                    >
                      <span>{showReasoning ? '▼' : '▶'}</span>
                      <span>{showReasoning ? 'Hide' : 'Show'} Prediction Reasoning</span>
                    </button>
                  </div>
                );
              })()}
            </>
          ) : null}

          {/* Prediction Reasoning - Show when toggled */}
          {showReasoning && (
            <PredictionReasoning 
              predictionData={{
                ...comparisonData,
                // Merge propPredictions into predictions for the component to access
                predictions: {
                  ...comparisonData.predictions,
                  ...propPredictions
                }
              }}
              selectedProp={selectedProp}
              playerName={comparisonData?.player || `${player.first_name} ${player.last_name}`}
            />
          )}

          {/* Chart - Show for all props */}
          {comparisonData?.props?.[selectedProp] && (
            <PredictionChart 
              stats={comparisonData?.stats || []}
              prediction={(() => {
                // Get prediction for selected prop
                if (selectedProp === 'points') {
                  return comparisonData?.prediction;
                }
                // Check if we have the prediction loaded
                const propData = comparisonData?.props?.[selectedProp];
                if (propData?.prediction != null) {
                  return propData.prediction;
                }
                // Check if we have it in propPredictions
                const pred = propPredictions[selectedProp];
                if (pred) {
                  return pred[`predicted_${selectedProp}`] || pred.predicted_value || pred.predicted_points;
                }
                return null;
              })()}
              bettingLine={comparisonData?.props?.[selectedProp]?.line || null}
              selectedProp={selectedProp}
              loading={loadingPredictions[selectedProp]}
              nextGameOpponent={comparisonData?.next_game?.opponent}
            />
          )}

          {/* Prop Odds Table - Under Chart */}
          {comparisonData?.props?.[selectedProp] && (
            <PropOddsTable 
              props={comparisonData?.props || {}}
              selectedProp={selectedProp}
            />
          )}

          {/* Game Log Table */}
          <GameLogTable 
            stats={comparisonData?.stats || []}
            selectedProp={selectedProp}
            prediction={(() => {
              // Get prediction for selected prop
              if (selectedProp === 'points') {
                return comparisonData?.prediction;
              }
              const propData = comparisonData?.props?.[selectedProp];
              if (propData?.prediction != null) {
                return propData.prediction;
              }
              const pred = propPredictions[selectedProp];
              if (pred) {
                return pred[`predicted_${selectedProp}`] || pred.predicted_points;
              }
              return null;
            })()}
            bettingLine={comparisonData?.props?.[selectedProp]?.line || null}
            nextGameOpponent={comparisonData?.next_game?.opponent}
          />

          {/* Injuries Table - Under Game Log */}
          <InjuriesTable 
            injuries={comparisonData?.injuries || null}
            playerTeam={comparisonData?.player_team}
            opponentTeam={comparisonData?.next_game?.opponent}
          />
        </div>
      </div>
      </div>
    </div>
  );
}

export default PlayerDetail;

