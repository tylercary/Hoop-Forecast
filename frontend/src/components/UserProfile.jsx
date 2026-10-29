import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, UserPlus, Check, Clock, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getTeamLogo } from '../utils/teamLogos';
import PredictionRow, { Avatar, goToPlayer } from './PredictionRow';
import {
  getUserProfile,
  getUserPredictions,
  getFriendshipStatus,
  sendFriendRequest,
} from '../services/firestoreService';


function Tile({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="py-3 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-none ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
  );
}

function FavoriteRow({ onClick, leading, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 py-2.5 text-left group"
    >
      {leading}
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-white group-hover:text-amber-300 transition-colors">
        {label}
      </span>
      <ChevronRight size={14} className="flex-none text-slate-600 group-hover:text-amber-300 transition-colors" />
    </button>
  );
}

function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [predictions, setPredictions] = useState([]);
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
        const [prof, preds] = await Promise.all([getUserProfile(userId), getUserPredictions(userId)]);
        setProfile(prof);
        setPredictions(preds);

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
      <div className="space-y-6">
        <div className="panel h-40 animate-pulse" />
        <div className="panel h-64 animate-pulse" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="panel p-10 text-center">
        <User className="mx-auto mb-3 text-slate-600" size={36} />
        <h3 className="text-lg font-semibold text-white mb-1">User not found</h3>
        <p className="text-sm text-slate-400">This profile doesn't exist.</p>
      </div>
    );
  }

  const isOwnProfile = user?.uid === userId;
  const displayName = profile.displayName || 'User';
  const initial = displayName[0]?.toUpperCase() || '?';

  // Always derive the record from the predictions themselves.
  const wins = predictions.filter((p) => p.result === 'win').length;
  const losses = predictions.filter((p) => p.result === 'loss').length;
  const pushes = predictions.filter((p) => p.result === 'push').length;
  const pending = predictions.filter((p) => !p.result).length;
  const decided = wins + losses;
  const winPct = decided > 0 ? ((wins / decided) * 100).toFixed(1) : null;

  const hasPlayers = profile.favorites?.length > 0;
  const hasTeams = profile.favoriteTeams?.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel p-6">
        <div className="flex items-start sm:items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            {profile.photoURL ? (
              <img
                src={profile.photoURL}
                alt={displayName}
                className="w-16 h-16 rounded-full object-cover ring-1 ring-slate-600 flex-none"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-amber-400 flex items-center justify-center flex-none">
                <span className="text-slate-900 text-2xl font-bold">{initial}</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-white truncate">{displayName}</h2>
              <p className="text-sm text-slate-400">
                {predictions.length === 0
                  ? 'No picks yet'
                  : `${predictions.length} pick${predictions.length === 1 ? '' : 's'}${
                      winPct ? ` · ${winPct}% on decided picks` : ''
                    }`}
              </p>
            </div>
          </div>

          {user && !isOwnProfile && (
            friendStatus?.status === 'accepted' ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-emerald-400 border border-emerald-500/40 bg-emerald-500/15">
                <Check size={15} /> Friends
              </span>
            ) : friendStatus?.status === 'pending' ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-amber-400 border border-amber-400/40 bg-amber-500/15">
                <Clock size={15} /> Request sent
              </span>
            ) : (
              <button
                onClick={handleSendFriendRequest}
                disabled={sendingRequest}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-amber-400 text-slate-900 hover:bg-amber-300 transition-colors disabled:opacity-50"
              >
                <UserPlus size={15} /> Add friend
              </button>
            )
          )}
        </div>

        <div className="mt-5 pt-5 border-t border-slate-700/60 grid grid-cols-2 sm:grid-cols-4 sm:divide-x divide-slate-700/60 gap-y-4">
          <Tile label="Record" value={`${wins}–${losses}–${pushes}`} sub="win – loss – push" />
          <Tile label="Win rate" value={winPct ? `${winPct}%` : '—'} sub={decided ? `${decided} decided` : 'nothing decided yet'} accent={winPct ? 'text-emerald-400' : 'text-slate-500'} />
          <Tile label="Picks" value={predictions.length} sub="all time" />
          <Tile label="Pending" value={pending} sub="waiting on games" accent={pending ? 'text-amber-400' : 'text-white'} />
        </div>
      </motion.section>

      {/* Favorites */}
      {(hasPlayers || hasTeams) && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="panel p-6"
        >
          <h3 className="panel-title mb-4">Favorites</h3>
          <div
            className={`grid grid-cols-1 ${
              hasPlayers && hasTeams ? 'lg:grid-cols-2 lg:divide-x lg:divide-slate-700/60' : ''
            } gap-y-6 lg:gap-y-0`}
          >
            {hasPlayers && (
              <div className={hasTeams ? 'lg:pr-10' : ''}>
                <div className="flex items-baseline justify-between border-b border-slate-700/60 pb-2 mb-1">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Players</span>
                  <span className="text-xs text-slate-500">{profile.favorites.length}</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {profile.favorites.map((fav) => (
                    <FavoriteRow
                      key={fav.playerId}
                      label={fav.playerName}
                      leading={<Avatar name={fav.playerName} size="w-8 h-8" textSize="text-[10px]" />}
                      onClick={() => goToPlayer(navigate, fav)}
                    />
                  ))}
                </div>
              </div>
            )}
            {hasTeams && (
              <div className={hasPlayers ? 'lg:pl-10' : ''}>
                <div className="flex items-baseline justify-between border-b border-slate-700/60 pb-2 mb-1">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Teams</span>
                  <span className="text-xs text-slate-500">{profile.favoriteTeams.length}</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {profile.favoriteTeams.map((fav) => (
                    <FavoriteRow
                      key={fav.teamAbbreviation}
                      label={fav.teamName}
                      leading={
                        getTeamLogo(fav.teamAbbreviation) ? (
                          <img src={getTeamLogo(fav.teamAbbreviation)} alt="" className="w-8 h-8 object-contain flex-none" />
                        ) : (
                          <span className="w-8 h-8 flex-none rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200 flex items-center justify-center">
                            {fav.teamAbbreviation}
                          </span>
                        )
                      }
                      onClick={() => navigate(`/team/${fav.teamAbbreviation}`)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* Recent picks */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="panel p-6"
      >
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="panel-title">Recent picks</h3>
          {predictions.length > 20 && <span className="text-xs text-slate-500">last 20 of {predictions.length}</span>}
        </div>
        {predictions.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No picks yet.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {predictions.slice(0, 20).map((pred) => (
              <PredictionRow key={pred.id} pred={pred} onClick={() => goToPlayer(navigate, pred)} />
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}

export default UserProfile;
