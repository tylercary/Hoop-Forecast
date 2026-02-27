import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getTeamLogo } from '../utils/teamLogos';

function Favorites() {
  const { user, favorites, favoriteTeams, toggleFavorite, toggleFavoriteTeam } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (!user) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <Star className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">Sign in to see your favorites</h3>
        <p className="text-gray-400">Save your favorite players and teams for quick access.</p>
      </div>
    );
  }

  if (favorites.length === 0 && favoriteTeams.length === 0) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <Star className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">No favorites yet</h3>
        <p className="text-gray-400">Search for a player or team and tap the star to add them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Star className="text-yellow-500 fill-yellow-500" size={24} />
        My Favorites
      </h2>

      {/* Player Favorites */}
      {favorites.length > 0 && (
        <>
          {favoriteTeams.length > 0 && (
            <h3 className="text-lg font-semibold text-white mt-2">Players</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {favorites.map((fav, index) => (
              <motion.div
                key={fav.playerId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 transition-all cursor-pointer group"
              >
                <div
                  className="flex items-center gap-3 p-4"
                  onClick={() => {
                    const nameSlug = encodeURIComponent(fav.playerName.toLowerCase().replace(/\s+/g, '-'));
                    const nameParts = fav.playerName.split(' ');
                    navigate(`/player/${fav.playerId}/${nameSlug}`, {
                      state: {
                        player: {
                          id: fav.playerId,
                          first_name: nameParts[0] || '',
                          last_name: nameParts.slice(1).join(' ') || '',
                        }
                      }
                    });
                  }}
                >
                  {/* Player Photo */}
                  <div className="flex-shrink-0">
                    <img
                      src={`/images/players/${fav.playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim()}.png`}
                      alt={fav.playerName}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-yellow-500/30 group-hover:ring-yellow-500 transition-all"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                    <div className="hidden w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 items-center justify-center ring-2 ring-yellow-500/30 group-hover:ring-yellow-500 transition-all">
                      <span className="text-white text-sm font-bold">
                        {fav.playerName.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                  </div>

                  {/* Name */}
                  <span className="flex-1 text-white font-semibold group-hover:text-yellow-400 transition-colors">
                    {fav.playerName}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(fav.playerId, fav.playerName);
                      }}
                      className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Star className="text-yellow-500 fill-yellow-500" size={18} />
                    </button>
                    <ChevronRight className="text-gray-500 group-hover:text-yellow-400 transition-colors" size={18} />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Team Favorites */}
      {favoriteTeams.length > 0 && (
        <>
          {favorites.length > 0 && (
            <h3 className="text-lg font-semibold text-white mt-2">Teams</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {favoriteTeams.map((fav, index) => (
              <motion.div
                key={fav.teamAbbreviation}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 hover:border-yellow-500/50 transition-all cursor-pointer group"
              >
                <div
                  className="flex items-center gap-3 p-4"
                  onClick={() => navigate(`/team/${fav.teamAbbreviation}`)}
                >
                  {/* Team Logo */}
                  <div className="flex-shrink-0">
                    {getTeamLogo(fav.teamAbbreviation) ? (
                      <img src={getTeamLogo(fav.teamAbbreviation)} alt={fav.teamName} className="w-10 h-10 object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                        <span className="text-white text-sm font-bold">{fav.teamAbbreviation}</span>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <span className="flex-1 text-white font-semibold group-hover:text-yellow-400 transition-colors">
                    {fav.teamName}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteTeam(fav.teamAbbreviation, fav.teamName);
                      }}
                      className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Star className="text-yellow-500 fill-yellow-500" size={18} />
                    </button>
                    <ChevronRight className="text-gray-500 group-hover:text-yellow-400 transition-colors" size={18} />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default Favorites;
