import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Trophy, TrendingUp, Target, UserPlus, Check, Clock, Star, ChevronRight } from 'lucide-react';
import { resolveImageUrl } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { getTeamLogo } from '../utils/teamLogos';
import {
  getUserProfile,
  getUserPredictions,
  getUserRecord,
  getFriendshipStatus,
  sendFriendRequest,
} from '../services/firestoreService';

const PROP_LABELS = {
  points: 'Pts',
  assists: 'Ast',
  rebounds: 'Reb',
  threes: '3PM',
  steals: 'Stl',
  blocks: 'Blk',
  turnovers: 'TO',
  pra: 'PRA',
  pr: 'P+R',
  pa: 'P+A',
  ra: 'R+A',
  points_rebounds: 'P+R',
  points_assists: 'P+A',
  rebounds_assists: 'R+A',
  points_rebounds_assists: 'PRA',
};

function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [record, setRecord] = useState({ wins: 0, losses: 0, pushes: 0 });
  const [friendStatus, setFriendStatus] = useState(null); // null, 'pending', 'accepted'
  const [loading, setLoading] = useState(true);
  const [sendingRequest, setSendingRequest] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [prof, preds, rec] = await Promise.all([
          getUserProfile(userId),
          getUserPredictions(userId),
          getUserRecord(userId),
        ]);
        setProfile(prof);
        setPredictions(preds);
        setRecord(rec);

        // Check friendship status
        if (user && user.uid !== userId) {
          const status = await getFriendshipStatus(user.uid, userId);
          setFriendStatus(status);
        }
      } catch (err) {
        console.error('Error loading profile:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userId, user]);

  const handleSendFriendRequest = async () => {
    if (!user || !profile || sendingRequest) return;
    setSendingRequest(true);
    try {
      await sendFriendRequest(
        user.uid,
        user.displayName || user.email?.split('@')[0] || 'User',
        userId,
        profile.displayName || 'User'
      );
      setFriendStatus({ status: 'pending' });
    } catch (err) {
      console.error('Error sending friend request:', err);
    } finally {
      setSendingRequest(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-gray-800 rounded-lg p-8 animate-pulse h-40" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-20" />
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <User className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">User not found</h3>
        <p className="text-gray-400">This profile doesn't exist.</p>
      </div>
    );
  }

  const isOwnProfile = user?.uid === userId;
  const displayName = profile.displayName || 'User';
  const initial = displayName[0]?.toUpperCase() || '?';

  // Always derive record from actual predictions (single source of truth)
  const wins = predictions.filter((p) => p.result === 'win').length;
  const losses = predictions.filter((p) => p.result === 'loss').length;
  const pushes = predictions.filter((p) => p.result === 'push').length;
  const total = wins + losses + pushes;
  const winPct = total > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {profile.photoURL ? (
              <img
                src={profile.photoURL}
                alt={displayName}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-yellow-500/30"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                <span className="text-white text-2xl font-bold">{initial}</span>
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-white">{displayName}</h2>
              <p className="text-sm text-gray-400">
                {total > 0 ? `${wins}-${losses}-${pushes} · ${winPct}% win rate` : 'No predictions yet'}
              </p>
            </div>
          </div>

          {/* Friend actions */}
          {user && !isOwnProfile && (
            <div>
              {friendStatus?.status === 'accepted' ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-green-500/20 text-green-400 border border-green-500/30">
                  <Check size={16} /> Friends
                </span>
              ) : friendStatus?.status === 'pending' ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  <Clock size={16} /> Pending
                </span>
              ) : (
                <button
                  onClick={handleSendFriendRequest}
                  disabled={sendingRequest}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-yellow-500 text-gray-900 hover:bg-yellow-400 transition-colors disabled:opacity-50"
                >
                  <UserPlus size={16} /> Add Friend
                </button>
              )}
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <Trophy className="mx-auto mb-1 text-yellow-500" size={18} />
            <p className="text-lg font-bold text-white">{wins}-{losses}-{pushes}</p>
            <p className="text-xs text-gray-400">Record</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <TrendingUp className="mx-auto mb-1 text-green-400" size={18} />
            <p className="text-lg font-bold text-white">{winPct}%</p>
            <p className="text-xs text-gray-400">Win Rate</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <Target className="mx-auto mb-1 text-blue-400" size={18} />
            <p className="text-lg font-bold text-white">{predictions.length}</p>
            <p className="text-xs text-gray-400">Total Picks</p>
          </div>
        </div>
      </motion.div>

      {/* Favorite Players */}
      {profile.favorites?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <Star className="text-yellow-500 fill-yellow-500" size={18} />
            Favorite Players
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {profile.favorites.map((fav) => (
              <motion.div
                key={fav.playerId}
                whileHover={{ scale: 1.01 }}
                onClick={() => {
                  const nameSlug = encodeURIComponent(fav.playerName.toLowerCase().replace(/\s+/g, '-'));
                  navigate(`/player/${fav.playerId}/${nameSlug}`, {
                    state: { player: { id: fav.playerId, first_name: fav.playerName.split(' ')[0] || '', last_name: fav.playerName.split(' ').slice(1).join(' ') || '' } },
                  });
                }}
                className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 p-3 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <img
                      src={resolveImageUrl(`/images/players/${fav.playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim()}.png`)}
                      alt={fav.playerName}
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-gray-600"
                      onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
                    />
                    <div className="hidden w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 items-center justify-center ring-2 ring-gray-600">
                      <span className="text-white text-xs font-bold">{fav.playerName.split(' ').map((n) => n[0]).join('')}</span>
                    </div>
                  </div>
                  <span className="text-white text-sm font-semibold group-hover:text-yellow-400 transition-colors truncate flex-1">{fav.playerName}</span>
                  <ChevronRight size={14} className="text-gray-500 group-hover:text-yellow-400 transition-colors flex-shrink-0" />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Favorite Teams */}
      {profile.favoriteTeams?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <Star className="text-yellow-500 fill-yellow-500" size={18} />
            Favorite Teams
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {profile.favoriteTeams.map((fav) => (
              <motion.div
                key={fav.teamAbbreviation}
                whileHover={{ scale: 1.01 }}
                onClick={() => navigate(`/team/${fav.teamAbbreviation}`)}
                className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 p-3 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  {getTeamLogo(fav.teamAbbreviation) && (
                    <img src={getTeamLogo(fav.teamAbbreviation)} alt={fav.teamName} className="w-8 h-8 object-contain flex-shrink-0" />
                  )}
                  <span className="text-white text-sm font-semibold group-hover:text-yellow-400 transition-colors truncate flex-1">{fav.teamName}</span>
                  <ChevronRight size={14} className="text-gray-500 group-hover:text-yellow-400 transition-colors flex-shrink-0" />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Predictions */}
      <h3 className="text-lg font-bold text-white">Recent Predictions</h3>
      {predictions.length === 0 ? (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 border border-gray-700 text-center">
          <p className="text-gray-400">No predictions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {predictions.slice(0, 20).map((pred, index) => (
            <motion.div
              key={pred.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => {
                const nameSlug = encodeURIComponent(pred.playerName.toLowerCase().replace(/\s+/g, '-'));
                navigate(`/player/${pred.playerId}/${nameSlug}`, {
                  state: {
                    player: {
                      id: pred.playerId,
                      first_name: pred.playerName.split(' ')[0] || '',
                      last_name: pred.playerName.split(' ').slice(1).join(' ') || '',
                    },
                  },
                });
              }}
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 p-4 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <img
                      src={resolveImageUrl(`/images/players/${pred.playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim()}.png`)}
                      alt={pred.playerName}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-600"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                    <div className="hidden w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 items-center justify-center ring-2 ring-gray-600">
                      <span className="text-white text-sm font-bold">
                        {pred.playerName.split(' ').map((n) => n[0]).join('')}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-white font-semibold group-hover:text-yellow-400 transition-colors">
                      {pred.playerName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {PROP_LABELS[pred.propType] || pred.propType} · {pred.opponent ? `vs ${pred.opponent} · ` : ''}{pred.gameDate}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
                    pred.pick === 'over'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}>
                    {pred.pick === 'over' ? 'OVER' : 'UNDER'} {parseFloat(pred.line).toFixed(1)}
                  </span>
                  {pred.result ? (
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      pred.result === 'win'
                        ? 'bg-green-600/30 text-green-300'
                        : pred.result === 'loss'
                        ? 'bg-red-600/30 text-red-300'
                        : 'bg-yellow-600/30 text-yellow-300'
                    }`}>
                      {pred.result.toUpperCase()}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-700 text-gray-400">
                      PENDING
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default UserProfile;
