import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Search, UserPlus, Check, X, ChevronRight, Trophy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  searchUsers,
  getFriends,
  getPendingRequests,
  acceptFriendRequest,
  declineFriendRequest,
  getUserPredictions,
} from '../services/firestoreService';

function Friends() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    loadFriendsData();
  }, [user]);

  async function loadFriendsData() {
    setLoading(true);
    try {
      const [friendsList, pending] = await Promise.all([
        getFriends(user.uid),
        getPendingRequests(user.uid),
      ]);
      setFriends(friendsList);
      setPendingRequests(pending);
    } catch (err) {
      console.error('Error loading friends:', err);
    } finally {
      setLoading(false);
    }
  }

  // Debounced search
  useEffect(() => {
    if (!searchTerm || searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchUsers(searchTerm);
        // Filter out self and existing friends
        const friendUids = new Set(friends.map((f) => f.uid));
        setSearchResults(results.filter((r) => r.uid !== user?.uid && !friendUids.has(r.uid)));
      } catch (err) {
        console.error('Error searching users:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchTerm, friends, user]);

  const handleAccept = async (requestId) => {
    try {
      await acceptFriendRequest(requestId);
      await loadFriendsData();
    } catch (err) {
      console.error('Error accepting request:', err);
    }
  };

  const handleDecline = async (requestId) => {
    try {
      await declineFriendRequest(requestId);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err) {
      console.error('Error declining request:', err);
    }
  };

  const handleCompareFriend = async (friend) => {
    if (selectedFriend?.uid === friend.uid) {
      setSelectedFriend(null);
      setComparisonData(null);
      return;
    }
    setSelectedFriend(friend);
    setLoadingComparison(true);
    try {
      const [myPreds, friendPreds] = await Promise.all([
        getUserPredictions(user.uid),
        getUserPredictions(friend.uid),
      ]);

      // Find matching predictions (same player + prop + gameDate)
      const matches = [];
      for (const myPred of myPreds) {
        const match = friendPreds.find(
          (fp) =>
            fp.playerId === myPred.playerId &&
            fp.propType === myPred.propType &&
            fp.gameDate === myPred.gameDate
        );
        if (match) {
          matches.push({ mine: myPred, theirs: match });
        }
      }
      setComparisonData({
        matches,
        myTotal: myPreds.length,
        theirTotal: friendPreds.length,
      });
    } catch (err) {
      console.error('Error loading comparison:', err);
    } finally {
      setLoadingComparison(false);
    }
  };

  if (!user) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <Users className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">Sign in to see friends</h3>
        <p className="text-gray-400">Add friends and compare your predictions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Users className="text-yellow-500" size={24} />
        Friends
      </h2>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search users by name..."
          className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
        />
        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-20 shadow-2xl">
            {searchResults.map((result) => (
              <button
                key={result.uid}
                onClick={() => {
                  navigate(`/profile/${result.uid}`);
                  setSearchTerm('');
                  setSearchResults([]);
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">
                      {(result.displayName || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="text-white font-medium">{result.displayName || 'User'}</span>
                </div>
                <ChevronRight className="text-gray-500" size={16} />
              </button>
            ))}
          </div>
        )}
        {searching && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg p-4 text-center text-gray-400 text-sm z-20">
            Searching...
          </div>
        )}
      </div>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <UserPlus className="text-yellow-500" size={18} />
            Friend Requests ({pendingRequests.length})
          </h3>
          {pendingRequests.map((req) => (
            <motion.div
              key={req.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-yellow-500/30 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">
                      {(req.fromUserName || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{req.fromUserName || 'User'}</p>
                    <p className="text-xs text-gray-400">wants to be your friend</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAccept(req.id)}
                    className="p-2 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={() => handleDecline(req.id)}
                    className="p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Friends List */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">
          {friends.length > 0 ? `My Friends (${friends.length})` : 'My Friends'}
        </h3>
        {loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-16" />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 border border-gray-700 text-center">
            <Users className="mx-auto mb-3 text-gray-600" size={36} />
            <p className="text-gray-400">No friends yet. Search for users above to add them!</p>
          </div>
        ) : (
          friends.map((friend, index) => (
            <motion.div
              key={friend.uid}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 overflow-hidden"
            >
              <div className="flex items-center justify-between p-4">
                <div
                  className="flex items-center gap-3 cursor-pointer group flex-1"
                  onClick={() => navigate(`/profile/${friend.uid}`)}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">
                      {(friend.name || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="text-white font-semibold group-hover:text-yellow-400 transition-colors">
                    {friend.name || 'User'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCompareFriend(friend)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedFriend?.uid === friend.uid
                        ? 'bg-yellow-500 text-gray-900'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <Trophy size={14} className="inline mr-1" />
                    Compare
                  </button>
                  <button
                    onClick={() => navigate(`/profile/${friend.uid}`)}
                    className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors text-gray-400"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {/* Comparison Panel */}
              {selectedFriend?.uid === friend.uid && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-gray-700 p-4 bg-gray-800/50"
                >
                  {loadingComparison ? (
                    <p className="text-gray-400 text-sm text-center">Loading comparison...</p>
                  ) : comparisonData ? (
                    <div>
                      <p className="text-sm text-gray-400 mb-3">
                        {comparisonData.matches.length > 0
                          ? `${comparisonData.matches.length} matching predictions found`
                          : 'No matching predictions yet — make picks on the same games!'}
                      </p>
                      {comparisonData.matches.length > 0 && (
                        <div className="space-y-2">
                          {comparisonData.matches.slice(0, 5).map((match, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between bg-gray-800 rounded-lg p-3 text-sm"
                            >
                              <div className="flex-1">
                                <p className="text-white font-medium">{match.mine.playerName}</p>
                                <p className="text-xs text-gray-400">{match.mine.gameDate}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-center">
                                  <p className="text-[10px] text-gray-500 mb-0.5">You</p>
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    match.mine.pick === 'over'
                                      ? 'bg-green-500/20 text-green-400'
                                      : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {match.mine.pick === 'over' ? 'O' : 'U'}
                                  </span>
                                </div>
                                <span className="text-gray-600">vs</span>
                                <div className="text-center">
                                  <p className="text-[10px] text-gray-500 mb-0.5">{friend.name?.split(' ')[0]}</p>
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    match.theirs.pick === 'over'
                                      ? 'bg-green-500/20 text-green-400'
                                      : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {match.theirs.pick === 'over' ? 'O' : 'U'}
                                  </span>
                                </div>
                                {match.mine.result && (
                                  <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${
                                    match.mine.result === 'win'
                                      ? 'bg-green-600/30 text-green-300'
                                      : match.mine.result === 'loss'
                                      ? 'bg-red-600/30 text-red-300'
                                      : 'bg-yellow-600/30 text-yellow-300'
                                  }`}>
                                    {match.mine.pick === match.theirs.pick ? 'SAME' : match.mine.result === 'win' ? 'YOU' : friend.name?.split(' ')[0]?.toUpperCase()}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </motion.div>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

export default Friends;
