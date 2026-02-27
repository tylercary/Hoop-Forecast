import { useState } from 'react';
import { motion } from 'framer-motion';

// Component for player image with fallback to initials
function PlayerImageWithFallback({ playerName, playerId, headshot }) {
  const [imageError, setImageError] = useState(false);
  const normalizedName = playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim();
  const localImageUrl = `/images/players/${normalizedName}.png`;
  const cdnImageUrl = playerId ? `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png` : null;
  const initials = playerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  // Build ordered fallback chain, skipping nulls
  const fallbackChain = [headshot, localImageUrl, cdnImageUrl].filter(Boolean);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentImageUrl = fallbackChain[currentIndex];

  const handleImageError = () => {
    if (currentIndex + 1 < fallbackChain.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setImageError(true);
    }
  };

  return (
    <div className="relative w-10 h-10">
      {!imageError && currentImageUrl ? (
        <img
          src={currentImageUrl}
          alt={playerName}
          className="w-10 h-10 rounded-full object-cover border border-gray-600"
          onError={handleImageError}
        />
      ) : null}
      <div 
        className={`w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-xs font-medium border border-gray-600 ${!imageError ? 'absolute inset-0 hidden' : ''}`}
        style={{ display: imageError ? 'flex' : 'none' }}
      >
        {initials}
      </div>
    </div>
  );
}

function InjuriesTable({ injuries, playerTeam, opponentTeam }) {
  const [showAll, setShowAll] = useState(false);

  if (!injuries || (!injuries.player_team?.injuries?.length && !injuries.opponent?.injuries?.length)) {
    // Still show the table header even if no injuries, but with a message
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
      >
        <div className="mb-4">
          <h3 className="text-2xl font-bold text-white mb-1">Injuries</h3>
          <p className="text-sm text-gray-400">Key injury updates for both teams</p>
        </div>
        <p className="text-gray-400 text-center py-8">No injuries reported</p>
      </motion.div>
    );
  }

  // Combine all injuries with team info
  const allInjuries = [
    ...(injuries.player_team?.injuries || []).map(inj => ({
      ...inj,
      team: injuries.player_team.team,
      teamName: playerTeam || injuries.player_team.team
    })),
    ...(injuries.opponent?.injuries || []).map(inj => ({
      ...inj,
      team: injuries.opponent.team,
      teamName: opponentTeam || injuries.opponent.team
    }))
  ];

  // Sort by impact score (most important first)
  allInjuries.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));

  // Show top 5 by default, all if showAll is true
  const displayedInjuries = showAll ? allInjuries : allInjuries.slice(0, 5);

  // Format status badge
  const getStatusBadge = (status) => {
    const statusLower = (status || '').toLowerCase();
    if (statusLower.includes('out') || statusLower.includes('doubtful')) {
      return { text: 'OUT', color: 'bg-red-500/20 text-red-400 border-red-500/50' };
    } else if (statusLower.includes('questionable') || statusLower.includes('day-to-day') || statusLower.includes('dtd')) {
      return { text: 'DTD', color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' };
    } else if (statusLower.includes('probable')) {
      return { text: 'PROBABLE', color: 'bg-green-500/20 text-green-400 border-green-500/50' };
    }
    return { text: status || 'UNKNOWN', color: 'bg-gray-500/20 text-gray-400 border-gray-500/50' };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-2xl font-bold text-white mb-1">Injuries</h3>
          <p className="text-sm text-gray-400">Key injury updates for both teams</p>
        </div>
        {allInjuries.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm font-medium transition-colors"
          >
            {showAll ? 'Show less' : 'Show all'}
            <svg
              className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {displayedInjuries.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No injuries reported</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400 uppercase">Player</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400 uppercase">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400 uppercase">Team</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400 uppercase">Injury</th>
              </tr>
            </thead>
            <tbody>
              {displayedInjuries.map((injury, index) => {
                const statusBadge = getStatusBadge(injury.status);
                
                return (
                  <motion.tr
                    key={`${injury.playerName}-${injury.team}-${index}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <PlayerImageWithFallback 
                          playerName={injury.playerName} 
                          playerId={injury.playerId}
                          headshot={injury.headshot}
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{injury.playerName}</span>
                          <svg className="w-4 h-4 text-gray-500 hover:text-gray-400 cursor-pointer" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${statusBadge.color}`}>
                        {statusBadge.text}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-gray-300 font-medium">{injury.team || injury.teamName}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-gray-300">
                        {injury.injury || injury.comment || injury.description || 'Not specified'}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

export default InjuriesTable;

