import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Users, Calendar, Shield, Target } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { getTeamLogo, getTeamName } from '../utils/teamLogos';

const OFFENSIVE_STATS = [
  { key: 'ppg', label: 'PPG', desc: 'Points Per Game' },
  { key: 'fgPct', label: 'FG%', desc: 'Field Goal %' },
  { key: 'threePtPct', label: '3P%', desc: '3-Point %' },
  { key: 'ftPct', label: 'FT%', desc: 'Free Throw %' },
  { key: 'apg', label: 'APG', desc: 'Assists Per Game' },
  { key: 'topg', label: 'TOPG', desc: 'Turnovers Per Game' },
];

const DEFENSIVE_STATS = [
  { key: 'rpg', label: 'RPG', desc: 'Rebounds Per Game' },
  { key: 'offRpg', label: 'ORPG', desc: 'Off. Rebounds Per Game' },
  { key: 'defRpg', label: 'DRPG', desc: 'Def. Rebounds Per Game' },
  { key: 'spg', label: 'SPG', desc: 'Steals Per Game' },
  { key: 'bpg', label: 'BPG', desc: 'Blocks Per Game' },
  { key: 'pfpg', label: 'PFPG', desc: 'Fouls Per Game' },
];

function TeamDetail() {
  const { abbreviation } = useParams();
  const navigate = useNavigate();
  const { user, isTeamFavorite, toggleFavoriteTeam } = useAuth();
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    async function fetchTeamData() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(`/search/team/${abbreviation}`);
        setTeamData(response.data);
      } catch (err) {
        console.error('Error fetching team:', err);
        setError(err.response?.data?.error || 'Failed to load team data');
      } finally {
        setLoading(false);
      }
    }
    fetchTeamData();
  }, [abbreviation]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <div className="bg-gray-800 rounded-xl p-8 animate-pulse h-32" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-gray-800 rounded-xl h-24 animate-pulse" />)}
        </div>
        <div className="bg-gray-800 rounded-xl p-4 animate-pulse h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
          <h3 className="text-xl font-bold text-white mb-2">Error</h3>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  const teamName = getTeamName(abbreviation);
  const teamLogo = getTeamLogo(abbreviation);
  const stats = teamData?.stats || {};
  const hasStats = Object.keys(stats).length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Team Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800 rounded-xl border border-gray-700 p-6"
      >
        <div className="flex items-center gap-4">
          {teamLogo && (
            <img src={teamLogo} alt={teamName} className="w-20 h-20 object-contain" />
          )}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white">{teamName}</h2>
            <div className="flex items-center gap-3 mt-1">
              {teamData?.record && (
                <span className="text-lg font-semibold text-yellow-400">{teamData.record}</span>
              )}
              {teamData?.standing && (
                <span className="text-sm text-gray-400">{teamData.standing}</span>
              )}
            </div>
          </div>
          {user && (
            <button
              onClick={() => toggleFavoriteTeam(abbreviation, teamName)}
              className="p-2.5 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <Star
                size={24}
                className={isTeamFavorite(abbreviation) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500 hover:text-yellow-500'}
              />
            </button>
          )}
        </div>
      </motion.div>

      {/* Record Cards + Next Game */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Overall', value: teamData?.record },
          { label: 'Home', value: teamData?.homeRecord },
          { label: 'Away', value: teamData?.awayRecord },
        ].map(({ label, value }) => value && (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center"
          >
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
          </motion.div>
        ))}

        {teamData?.nextGame && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            onClick={() => navigate(`/games/${teamData.nextGame.id}`)}
            className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center cursor-pointer hover:border-yellow-500/50 transition-colors"
          >
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
              <Calendar className="w-3 h-3" /> Next Game
            </p>
            <p className="text-sm font-bold text-white">{teamData.nextGame.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(teamData.nextGame.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
          </motion.div>
        )}
      </div>

      {/* Season Stats */}
      {hasStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-5"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-yellow-400" />
              Offense
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {OFFENSIVE_STATS.map(({ key, label, desc }) => (
                <div key={key} className="text-center">
                  <p className="text-xl font-bold text-white tabular-nums">{stats[key] || '-'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gray-800 rounded-xl border border-gray-700 p-5"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              Defense
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {DEFENSIVE_STATS.map(({ key, label, desc }) => (
                <div key={key} className="text-center">
                  <p className="text-xl font-bold text-white tabular-nums">{stats[key] || '-'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Roster Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Users size={16} className="text-yellow-400" />
            Roster
            {teamData?.roster && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-bold border border-yellow-500/30">
                {teamData.roster.length}
              </span>
            )}
          </h3>
        </div>

        {teamData?.roster?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-700/50">
                  <th className="text-left px-4 py-3 sticky left-0 bg-gray-800 min-w-[180px]">Name</th>
                  <th className="text-center px-3 py-3">POS</th>
                  <th className="text-center px-3 py-3">AGE</th>
                  <th className="text-center px-3 py-3">HT</th>
                  <th className="text-center px-3 py-3">WT</th>
                  <th className="text-left px-3 py-3">College</th>
                  <th className="text-right px-4 py-3">Salary</th>
                </tr>
              </thead>
              <tbody>
                {teamData.roster.map((player) => (
                  <tr
                    key={player.id}
                    onClick={() => {
                      const nameSlug = encodeURIComponent(player.displayName.toLowerCase().replace(/\s+/g, '-'));
                      navigate(`/player/${player.id}/${nameSlug}`, {
                        state: {
                          player: {
                            id: player.id,
                            first_name: player.firstName,
                            last_name: player.lastName,
                            position: player.position,
                            team: { abbreviation },
                          },
                        },
                      });
                    }}
                    className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 sticky left-0 bg-gray-800">
                      <div className="flex items-center gap-3">
                        {player.headshot ? (
                          <img
                            src={player.headshot}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover bg-gray-700"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                            {player.displayName?.split(' ').map((n) => n[0]).join('')}
                          </div>
                        )}
                        <div>
                          <span className="text-white font-medium hover:text-yellow-400 transition-colors">
                            {player.displayName}
                          </span>
                          {player.jersey && <span className="text-gray-500 text-xs ml-1.5">#{player.jersey}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-3 py-3 text-gray-300">{player.position}</td>
                    <td className="text-center px-3 py-3 text-gray-300 tabular-nums">{player.age || '--'}</td>
                    <td className="text-center px-3 py-3 text-gray-300">{player.height || '--'}</td>
                    <td className="text-center px-3 py-3 text-gray-300">{player.weight || '--'}</td>
                    <td className="text-left px-3 py-3 text-gray-400">{player.college || '--'}</td>
                    <td className="text-right px-4 py-3 text-gray-300 tabular-nums">{player.salary || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center">
            <p className="text-gray-400">No roster data available.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default TeamDetail;
