import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, ChevronDown, Filter, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api, { resolveImageUrl } from '../utils/api';
import { getTeamLogo } from '../utils/teamLogos';

// Module-level cache to persist data across component remounts (e.g., back navigation)
const dataCache = {
  playersWithLines: null,
  trendingProps: null,
  lastFetched: 0,
  TTL: 5 * 60 * 1000 // 5 minutes
};

// Helper function to format prop type for display
const formatPropType = (propType) => {
  const labels = {
    'points': 'PTS',
    'rebounds': 'REB',
    'assists': 'AST',
    'threes': '3PT',
    'pra': 'PTS+REB+AST',
    'pr': 'PTS+REB',
    'pa': 'PTS+AST',
    'ra': 'REB+AST',
    'steals': 'STL',
    'blocks': 'BLK'
  };
  return labels[propType] || propType.toUpperCase();
};

function Home() {
  const navigate = useNavigate();
  const { user, isFavorite, toggleFavorite, isTeamFavorite, toggleFavoriteTeam } = useAuth();
  const [playersWithLines, setPlayersWithLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [trendingProps, setTrendingProps] = useState([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [teamSearchResults, setTeamSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [showSearch, setShowSearch] = useState(true);
  const [visibleCount, setVisibleCount] = useState(12);
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterProp, setFilterProp] = useState('points');

  // Derive unique teams and prop types from player data for filters
  const uniqueTeams = [...new Set(
    playersWithLines.flatMap(p => [p.home_team, p.away_team]).filter(Boolean)
  )].sort();

  const uniqueProps = [...new Set(
    playersWithLines.map(p => p.prop_type).filter(Boolean)
  )].sort();

  // Apply filters
  const filteredPlayers = playersWithLines.filter(p => {
    if (filterTeam !== 'all' && p.home_team !== filterTeam && p.away_team !== filterTeam) return false;
    if (filterProp !== 'all' && p.prop_type !== filterProp) return false;
    return true;
  });

  const hasActiveFilters = filterTeam !== 'all' || (filterProp !== 'all' && filterProp !== 'points');

  // Scroll to top when component mounts (e.g., when navigating back from player detail)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Fetch players with betting lines and trending props on mount, using cache for back navigation
  useEffect(() => {
    const now = Date.now();
    const cacheValid = dataCache.lastFetched && (now - dataCache.lastFetched < dataCache.TTL);

    if (cacheValid && dataCache.playersWithLines && dataCache.trendingProps) {
      setPlayersWithLines(dataCache.playersWithLines);
      setTrendingProps(dataCache.trendingProps);
      setLoadingLines(false);
      setLoadingTrending(false);
    } else {
      fetchPlayersWithLines();
      fetchTrendingProps();
    }
  }, []);

  const fetchPlayersWithLines = async () => {
    setLoadingLines(true);
    try {
      const response = await api.get(`/player/with-lines`);
      const data = response.data || [];
      setPlayersWithLines(data);
      dataCache.playersWithLines = data;
    } catch (err) {
      console.error('Error fetching players with lines:', err);
      setPlayersWithLines([]);
    } finally {
      setLoadingLines(false);
    }
  };

  const fetchTrendingProps = async () => {
    setLoadingTrending(true);
    try {
      const response = await api.get(`/trending/props`);
      const data = response.data || [];
      setTrendingProps(data);
      dataCache.trendingProps = data;
      dataCache.lastFetched = Date.now();
    } catch (err) {
      console.error('Error fetching trending props:', err);
      setTrendingProps([]);
    } finally {
      setLoadingTrending(false);
    }
  };

  // Debounced search - for players or teams
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setTeamSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Set searching immediately when user types
    setIsSearching(true);

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const performSearch = async (query) => {
    setIsSearching(true);
    setError(null);

    try {
      const [playersRes, teamsRes] = await Promise.all([
        api.get(`/search`, { params: { q: query, type: 'players' } }).catch(() => ({ data: [] })),
        api.get(`/search`, { params: { q: query, type: 'teams' } }).catch(() => ({ data: [] })),
      ]);
      setSearchResults(playersRes.data || []);
      setTeamSearchResults(teamsRes.data || []);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to search. Please try again.');
      setSearchResults([]);
      setTeamSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectPlayer = async (player) => {
    // Scroll to top immediately when player is selected
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Get player name - handle different formats
    let playerName;
    if (typeof player === 'string') {
      playerName = player;
    } else if (player.name) {
      playerName = player.name;
    } else if (player.first_name && player.last_name) {
      playerName = `${player.first_name} ${player.last_name}`;
    } else {
      console.error('Invalid player object:', player);
      return;
    }

    const bettingLineData = {
      betting_line: player.betting_line,
      bookmaker: player.bookmaker,
      event_id: player.event_id,
      home_team: player.home_team,
      away_team: player.away_team
    };

    // If player already has an ID and full data (from search results), navigate directly
    if (player.id && player.first_name && player.last_name) {
      const playerNameSlug = encodeURIComponent(playerName.replace(/\s+/g, '-').toLowerCase());
      navigate(`/player/${player.id}/${playerNameSlug}`, {
        state: { player: { ...player, ...bettingLineData } }
      });
      return;
    }

    // Otherwise, create temporary player and search for details
    const nameParts = playerName.split(' ');
    const immediatePlayer = {
      id: Math.random().toString(),
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      position: 'N/A',
      team: { abbreviation: 'N/A' },
      ...bettingLineData
    };

    // Navigate with player data in state
    const playerNameSlug = encodeURIComponent(playerName.replace(/\s+/g, '-').toLowerCase());
    navigate(`/player/${immediatePlayer.id}/${playerNameSlug}`, {
      state: { player: immediatePlayer }
    });

    // Then try to search for full player details in the background
    try {
      const response = await api.get(`/search`, {
        params: { q: playerName }
      });

      if (response.data && response.data.length > 0) {
        const fullPlayer = {
          ...response.data[0],
          ...bettingLineData
        };
        const fullPlayerName = fullPlayer.name || `${fullPlayer.first_name} ${fullPlayer.last_name}`;
        const updatedPlayerNameSlug = encodeURIComponent(fullPlayerName.replace(/\s+/g, '-').toLowerCase());
        navigate(`/player/${fullPlayer.id}/${updatedPlayerNameSlug}`, {
          state: { player: fullPlayer },
          replace: true
        });
      }
    } catch (err) {
      console.log('Search failed, using basic player object:', err.message);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section with Gradient Background */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="relative pb-10 pt-8"
      >
        
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          {/* Title Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-center mb-8"
          >
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-3 leading-tight">
              NBA Player Prop <span className="text-yellow-500">Analyzer</span>
            </h1>
            <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              AI-powered predictions for NBA player performance
            </p>
          </motion.div>

          {/* Floating Search Container */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="max-w-3xl mx-auto"
          >
            <div className="bg-slate-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-5 border border-white/5">
          <div className="relative">
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any NBA player or team..."
                  className="w-full pl-12 pr-12 py-3.5 text-base bg-slate-700/50 text-white border border-slate-600/50 rounded-xl focus:outline-none focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/20 placeholder-gray-400 transition-all duration-200"
            />
            {isSearching && (
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-600 border-t-yellow-500"></div>
              </div>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl backdrop-blur-sm"
            >
              {error}
            </motion.div>
          )}

          {/* Team Search Results */}
          {teamSearchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4"
            >
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Teams</h4>
              <div className="space-y-1.5">
                {teamSearchResults.map((team, index) => (
                  <motion.div
                    key={team.abbreviation}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.01, duration: 0.1 }}
                    onClick={() => navigate(`/team/${team.abbreviation}`)}
                    className="p-3 bg-slate-700/50 rounded-lg cursor-pointer transition-all duration-150 hover:bg-slate-600/70 border border-transparent hover:border-yellow-500/30 group"
                  >
                    <div className="flex items-center gap-3">
                      {team.logo && (
                        <img src={team.logo} alt={team.displayName} className="w-8 h-8 object-contain flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-sm group-hover:text-yellow-400 transition-colors">{team.displayName}</h4>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {team.abbreviation}{team.record ? ` · ${team.record}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {user && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavoriteTeam(team.abbreviation, team.displayName);
                            }}
                            className="p-1 rounded-lg hover:bg-slate-600 transition-colors"
                          >
                            <Star
                              size={16}
                              className={isTeamFavorite(team.abbreviation) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500 hover:text-yellow-500'}
                            />
                          </button>
                        )}
                        <svg
                          className="w-5 h-5 text-gray-400 group-hover:text-yellow-400 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Player Search Results */}
          {searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4"
            >
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Players</h4>
              <div className="max-h-96 overflow-y-auto pr-2 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800/50">
                {searchResults.map((player, index) => (
                  <motion.div
                    key={player.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      delay: index * 0.01,
                      duration: 0.1
                    }}
                    onClick={() => handleSelectPlayer(player)}
                    className="p-3 bg-slate-700/50 rounded-lg cursor-pointer transition-all duration-150 hover:bg-slate-600/70 border border-transparent hover:border-yellow-500/30 group"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <h4 className="font-semibold text-white text-sm">
                          {player.first_name} {player.last_name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {player.position} • {player.team?.abbreviation || 'Free Agent'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {user && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(String(player.id), `${player.first_name} ${player.last_name}`);
                            }}
                            className="p-1 rounded-lg hover:bg-slate-600 transition-colors"
                          >
                            <Star
                              size={16}
                              className={isFavorite(String(player.id)) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500 hover:text-yellow-500'}
                            />
                          </button>
                        )}
                        <svg
                          className="w-5 h-5 text-gray-400 group-hover:text-yellow-400 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {searchQuery && !isSearching && searchResults.length === 0 && teamSearchResults.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 text-center text-gray-400 py-8"
            >
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>No players or teams found. Try a different search term.</p>
            </motion.div>
          )}
        </div>
      </motion.div>
        </div>
      </motion.div>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="border-t border-white/5 mb-8"></div>
      </div>

      {/* Trending Props Section - Horizontal Scroll */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1 leading-tight flex items-center gap-2">
                <span>Trending Props Today</span>
                <img 
                  src="/fire.gif" 
                  alt="trending" 
                  className="w-6 h-6 fire-emoji select-none inline-block"
                  style={{ imageRendering: 'high-quality' }}
                />
              </h2>
              <p className="text-gray-400 text-sm font-medium">
                Props with the most sportsbook activity
              </p>
            </div>
            {trendingProps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg backdrop-blur-sm"
              >
                <span className="text-amber-400 font-bold text-xs">
                  {trendingProps.length} Trending
                </span>
              </motion.div>
            )}
          </div>

          {/* Horizontal Scroll Container */}
          {loadingTrending ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-center py-12"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="rounded-full h-12 w-12 border-4 border-slate-700 border-t-amber-500 mx-auto"
              />
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-4 text-gray-300 text-sm font-medium"
              >
                Loading trending props...
              </motion.p>
            </motion.div>
          ) : trendingProps.length > 0 ? (
            <div className="overflow-x-auto overflow-y-visible snap-x snap-mandatory scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent py-4">
              <div className="flex gap-4 px-1">
                {trendingProps.map((prop, index) => (
                  <motion.div
                    key={`${prop.player}-${prop.prop_type}-${prop.line}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ 
                      delay: index * 0.05, 
                      duration: 0.3,
                      ease: "easeOut"
                    }}
                    whileHover={{ 
                      y: -4,
                      transition: { duration: 0.2, ease: "easeOut" }
                    }}
                    whileTap={{ y: -2 }}
                    onClick={() => {
                      handleSelectPlayer({ 
                        name: prop.player,
                        betting_line: prop.line,
                        prop_type: prop.prop_type,
                        home_team: prop.home_team,
                        away_team: prop.away_team,
                        event_id: prop.event_id
                      });
                    }}
                    className="trending-card relative flex-shrink-0 w-72 snap-start rounded-2xl shadow-xl hover:shadow-2xl hover:shadow-amber-500/20 transition-all duration-300 cursor-pointer border border-slate-700/50 hover:border-amber-500/50 group"
                  >
                    {/* Card Background - Below embers */}
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl -z-10 overflow-hidden"></div>
                    
                    {/* Rising Fire Embers Background - z-0 */}
                    <div className="absolute inset-0 z-0 pointer-events-none overflow-visible">
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                      <div className="ember"></div>
                    </div>

                    {/* Card Content - z-20 (front-most layer) */}
                    <div className="relative z-20 p-4 antialiased will-change-auto">
                      {/* Player Image & Name Header */}
                      <div className="flex items-center gap-3 mb-3">
                        {/* Player Image - z-30 (highest layer) */}
                        <div className="relative z-30 flex-shrink-0">
                          {prop.player_image ? (
                            <img
                              src={resolveImageUrl(prop.player_image)}
                              alt={prop.player}
                              loading="lazy"
                              className="w-14 h-14 rounded-full object-cover ring-2 ring-amber-500/30 group-hover:ring-amber-500 select-none pointer-events-none"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextElementSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div
                            className={`${prop.player_image ? 'hidden' : 'flex'} w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 items-center justify-center ring-2 ring-amber-500/30 group-hover:ring-amber-500 transition-all duration-200`}
                          >
                            <span className="text-white text-lg font-bold">
                              {prop.player.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                        </div>
                        
                        {/* Player Name & Prop Type */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-white mb-1 group-hover:text-amber-400 transition-colors flex items-center gap-1.5">
                            <span className="truncate">{prop.player}</span>
                            <img 
                              src="/fire.gif" 
                              alt="trending" 
                              className="w-4 h-4 flex-shrink-0 fire-emoji select-none"
                              style={{ imageRendering: 'high-quality' }}
                            />
                          </h3>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-block px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px] font-bold border border-amber-500/30">
                              {formatPropType(prop.prop_type)}
                            </span>
                            <span className="text-[10px] text-gray-500">•</span>
                            <p className="text-[10px] text-gray-400 flex items-center gap-2 flex-wrap">
                              {getTeamLogo(prop.home_team) ? (
                                <img 
                                  src={getTeamLogo(prop.home_team)} 
                                  alt={prop.home_team}
                                  className="w-3 h-3 object-contain"
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              ) : (
                                <span className="font-medium">{prop.home_team}</span>
                              )}
                              <span className="text-gray-600 px-1.5 font-semibold">VS</span>
                              {getTeamLogo(prop.away_team) ? (
                                <img 
                                  src={getTeamLogo(prop.away_team)} 
                                  alt={prop.away_team}
                                  className="w-3 h-3 object-contain"
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              ) : (
                                <span className="font-medium">{prop.away_team}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Line */}
                      <div className="mb-2.5 bg-slate-700/30 rounded-lg p-2.5 border border-slate-600/30">
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Line</p>
                        <p className="text-xl font-extrabold text-amber-400 leading-tight">
                          {prop.line}
                        </p>
                      </div>

                      {/* Book Count Badge */}
                      <div className="mb-2.5">
                        <div className="bg-gradient-to-r from-amber-500/10 to-yellow-500/5 rounded-lg p-2 border border-amber-500/20">
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-gray-400 leading-none">Listed at</p>
                              <p className="text-xs font-bold text-amber-400 leading-tight">
                                {prop.bookCount} books
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Best Odds */}
                      {prop.bestOdds && (
                        <div className="bg-slate-700/20 rounded-lg p-2 border border-slate-600/20">
                          <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5 leading-none">Best Odds</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-white truncate mr-2">
                              {prop.bestOdds.sportsbook}
                            </span>
                            <span className={`text-sm font-bold ${prop.bestOdds.odds > 0 ? 'text-green-400' : 'text-white'}`}>
                              {prop.bestOdds.odds > 0 ? '+' : ''}{prop.bestOdds.odds}
                            </span>
                          </div>
                          <p className="text-[8px] text-gray-500 mt-0.5 capitalize leading-none">
                            {prop.bestOdds.type}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800/40 backdrop-blur-sm rounded-2xl shadow-xl p-12 text-center border border-slate-700/50"
            >
              <svg className="w-16 h-16 mx-auto mb-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <p className="text-gray-300 mb-2 text-lg font-semibold">
                No trending props available
              </p>
              <p className="text-sm text-gray-400">
                Check back soon for market activity
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Featured Players Section - Vertical Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6 flex items-end justify-between"
        >
        <div>
            <h2 className="text-2xl font-bold text-white mb-1 leading-tight">
            Featured Players
          </h2>
            <p className="text-gray-400 text-sm font-medium">
            Players with active betting lines
          </p>
        </div>
        {playersWithLines.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg backdrop-blur-sm"
            >
              <span className="text-yellow-400 font-bold text-xs">
              {filteredPlayers.length} Available
            </span>
            </motion.div>
        )}
        </motion.div>

      {/* Filters */}
      {playersWithLines.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Filter size={16} className="text-gray-400" />
          <select
            value={filterTeam}
            onChange={(e) => { setFilterTeam(e.target.value); setVisibleCount(12); }}
            className="bg-slate-800/80 text-white text-sm rounded-lg px-3 py-2 border border-slate-700/50 focus:border-yellow-500/50 focus:outline-none cursor-pointer"
          >
            <option value="all">All Teams</option>
            {uniqueTeams.map(team => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
          <select
            value={filterProp}
            onChange={(e) => { setFilterProp(e.target.value); setVisibleCount(12); }}
            className="bg-slate-800/80 text-white text-sm rounded-lg px-3 py-2 border border-slate-700/50 focus:border-yellow-500/50 focus:outline-none cursor-pointer"
          >
            <option value="all">All Props</option>
            {uniqueProps.map(prop => (
              <option key={prop} value={prop}>{formatPropType(prop)}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterTeam('all'); setFilterProp('points'); setVisibleCount(12); }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-800/60"
            >
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Players with Lines Grid */}
      {loadingLines ? (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center py-20"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="rounded-full h-16 w-16 border-4 border-slate-700 border-t-yellow-500 mx-auto"
            />
            <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-6 text-gray-300 text-lg font-medium"
            >
              Loading players with betting lines...
            </motion.p>
            <div className="flex items-center justify-center space-x-2 mt-4">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 bg-yellow-500 rounded-full"
                  animate={{
                    y: [0, -8, 0],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut"
                  }}
                />
              ))}
            </div>
        </motion.div>
      ) : filteredPlayers.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
          {filteredPlayers.slice(0, visibleCount).map((player, index) => (
            <motion.div
              key={`${player.name}-${index}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
                transition={{ 
                  delay: index * 0.05, 
                  duration: 0.3,
                  ease: "easeOut"
                }}
                whileHover={{ 
                  y: -4, 
                  scale: 1.01,
                  transition: { duration: 0.2 }
                }}
                whileTap={{ scale: 0.98 }}
              onClick={() => {
                handleSelectPlayer({ 
                  name: player.name,
                  betting_line: player.betting_line,
                  bookmaker: player.bookmaker,
                  event_id: player.event_id,
                  home_team: player.home_team,
                  away_team: player.away_team
                });
              }}
                className="relative bg-slate-800/60 backdrop-blur-sm rounded-2xl shadow-xl hover:shadow-2xl hover:shadow-yellow-500/20 transition-all duration-300 cursor-pointer overflow-hidden border border-slate-700/50 hover:border-yellow-500/50 group"
            >
                {/* Favorite Star */}
                {user && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(String(player.player_id || player.name), player.name);
                    }}
                    className="absolute top-3 right-3 p-1 transition-colors z-10"
                  >
                    <Star
                      size={16}
                      className={isFavorite(String(player.player_id || player.name)) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-500 hover:text-yellow-500'}
                    />
                  </button>
                )}

                {/* Player Image */}
                <div className="flex justify-center pt-5 pb-2.5">
                {player.player_image ? (
                  <img
                    src={resolveImageUrl(player.player_image)}
                    alt={player.name}
                    loading="lazy"
                      className="w-24 h-24 rounded-full object-cover ring-2 ring-gray-500/40 group-hover:ring-yellow-500 shadow-xl transition-all duration-300"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      const fallback = e.target.nextElementSibling;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div 
                    className={`${player.player_image ? 'hidden' : 'flex'} w-24 h-24 rounded-full bg-gradient-to-br from-gray-500 via-gray-400 to-gray-500 items-center justify-center ring-2 ring-gray-500/40 group-hover:ring-yellow-500 shadow-xl transition-all duration-300`}
                >
                    <span className="text-white text-3xl font-bold">
                    {player.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
              </div>

              {/* Player Info */}
                <div className="px-4 pb-4 text-center">
                  <h3 className="font-bold text-base text-white mb-0.5 truncate group-hover:text-yellow-400 transition-colors">
                  {player.name}
                </h3>
                  <div className="text-xs text-gray-400 mb-4">
                    {player.home_team} vs {player.away_team}
                  </div>

                {/* Prop Line Box */}
                  <div className="rounded-lg border border-slate-600/40 bg-slate-700/30 p-2.5 mb-4">
                    <div className="text-xs font-semibold text-yellow-400 mb-0.5">
                      {(() => {
                        const propLabels = {
                          points: 'PTS',
                          assists: 'AST',
                          rebounds: 'REB',
                          threes: '3PT',
                          steals: 'STL',
                          blocks: 'BLK',
                          pra: 'PTS + AST + REB',
                          pr: 'PTS + REB',
                          pa: 'PTS + AST',
                          ra: 'REB + AST',
                          points_rebounds: 'PTS + REB',
                          points_assists: 'PTS + AST',
                          rebounds_assists: 'REB + AST',
                          points_rebounds_assists: 'PTS + AST + REB'
                        };
                        return propLabels[player.prop_type] || player.prop_type?.toUpperCase() || 'PTS';
                      })()}
                    </div>
                    <div className="text-2xl font-extrabold text-yellow-400">
                      {player.betting_line}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{player.bookmaker}</div>
                  </div>

                  {/* View Button */}
                  <button className="w-full px-4 py-2.5 bg-gray-800 text-white rounded-xl hover:bg-gray-700 hover:shadow-yellow-500/20 transition-all font-bold shadow-lg border border-gray-700 hover:border-yellow-500/50">
                    View Analysis
                  </button>
              </div>
            </motion.div>
          ))}
        </div>
          {filteredPlayers.length > visibleCount && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center mt-8"
            >
              <button
                onClick={() => setVisibleCount(prev => prev + 12)}
                className="flex items-center gap-2 px-6 py-3 bg-slate-800/60 backdrop-blur-sm text-white rounded-xl hover:bg-slate-700/60 transition-all font-semibold border border-slate-700/50 hover:border-yellow-500/50"
              >
                <span>Show More</span>
                <ChevronDown size={18} />
                <span className="text-xs text-gray-400">
                  ({filteredPlayers.length - visibleCount} remaining)
                </span>
              </button>
            </motion.div>
          )}
        </>
      ) : hasActiveFilters && playersWithLines.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
            className="bg-slate-800/40 backdrop-blur-sm rounded-2xl shadow-xl p-12 text-center border border-slate-700/50"
        >
          <p className="text-gray-300 mb-2 text-lg font-semibold">
            No players match your filters
          </p>
          <button
            onClick={() => { setFilterTeam('all'); setFilterProp('all'); }}
            className="mt-3 text-sm text-yellow-400 hover:text-yellow-300 transition-colors"
          >
            Clear all filters
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
            className="bg-slate-800/40 backdrop-blur-sm rounded-2xl shadow-xl p-12 text-center border border-slate-700/50"
        >
            <svg className="w-20 h-20 mx-auto mb-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-300 mb-2 text-lg font-semibold">
            No players with betting lines available
          </p>
          <p className="text-sm text-gray-400">
            Use the search above to find any player and see their prediction
          </p>
        </motion.div>
      )}
      </div>

    </div>
  );
}

export default Home;
