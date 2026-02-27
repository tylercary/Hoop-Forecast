import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Users, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { getTeamLogo, getTeamName } from '../utils/teamLogos';

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
      <div className="space-y-4">
        <div className="bg-gray-800 rounded-xl p-8 animate-pulse h-32" />
        <div className="bg-gray-800 rounded-xl p-4 animate-pulse h-8 w-32" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-4 animate-pulse h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <h3 className="text-xl font-bold text-white mb-2">Error</h3>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }

  const teamName = getTeamName(abbreviation);
  const teamLogo = getTeamLogo(abbreviation);

  return (
    <div className="space-y-6">
      {/* Team Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 p-6"
      >
        <div className="flex items-center gap-4">
          {teamLogo && (
            <img src={teamLogo} alt={teamName} className="w-20 h-20 object-contain" />
          )}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white">{teamName}</h2>
            <p className="text-gray-400 text-sm mt-1">
              {teamData?.record ? `Record: ${teamData.record}` : 'Record unavailable'}
            </p>
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

      {/* Roster */}
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <Users size={18} className="text-yellow-500" />
        Roster
        {teamData?.roster && (
          <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-bold border border-yellow-500/30">
            {teamData.roster.length}
          </span>
        )}
      </h3>

      {teamData?.roster?.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teamData.roster.map((player, index) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.02 }}
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
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 hover:border-yellow-500/50 p-4 cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {player.headshot ? (
                    <img
                      src={player.headshot}
                      alt={player.displayName}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-600"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 items-center justify-center ring-2 ring-gray-600"
                    style={{ display: player.headshot ? 'none' : 'flex' }}
                  >
                    <span className="text-white text-sm font-bold">
                      {player.displayName?.split(' ').map((n) => n[0]).join('')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate group-hover:text-yellow-400 transition-colors">
                    {player.displayName}
                  </p>
                  <p className="text-xs text-gray-400">
                    {player.jersey ? `#${player.jersey} · ` : ''}{player.position}
                  </p>
                </div>
                <ChevronRight size={16} className="text-gray-500 group-hover:text-yellow-400 transition-colors flex-shrink-0" />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 border border-gray-700 text-center">
          <p className="text-gray-400">No roster data available.</p>
        </div>
      )}
    </div>
  );
}

export default TeamDetail;
