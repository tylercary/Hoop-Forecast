import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import TrendingPropCard from './TrendingPropCard';
import FeaturedPlayers from './FeaturedPlayers';

// Module-level cache to persist data across component remounts (e.g., back navigation)
const dataCache = {
  playersWithLines: null,
  trendingProps: null,
  lastFetched: 0,
  TTL: 5 * 60 * 1000 // 5 minutes
};

function Home() {
  const navigate = useNavigate();
  const { user, isFavorite, toggleFavorite, isTeamFavorite, toggleFavoriteTeam } = useAuth();
  const [playersWithLines, setPlayersWithLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [trendingProps, setTrendingProps] = useState([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const trendingScrollRef = useRef(null);

  // Scroll the trending row by about one viewport of cards
  const scrollTrending = (direction) => {
    const row = trendingScrollRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: 'smooth' });
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [teamSearchResults, setTeamSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [showSearch, setShowSearch] = useState(true);
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
      prop_type: player.prop_type,
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
            <div className="bg-slate-800/80 backdrop-blur-xl rounded-lg shadow-2xl p-5 border border-white/5">
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
                  className="w-full pl-12 pr-12 py-3.5 text-base bg-slate-700/50 text-white border border-slate-600/50 rounded-lg focus:outline-none focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/20 placeholder-gray-400 transition-all duration-200"
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
                  className="mt-4 p-4 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg backdrop-blur-sm"
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
                <Flame size={22} className="text-amber-400" strokeWidth={2.5} />
                <span>Trending Props</span>
              </h2>
              <p className="text-slate-400 text-sm">
                Most-listed player props across sportsbooks right now
              </p>
            </div>
            {trendingProps.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Scroll trending props left"
                  onClick={() => scrollTrending(-1)}
                  className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-amber-400/60 flex items-center justify-center transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Scroll trending props right"
                  onClick={() => scrollTrending(1)}
                  className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-amber-400/60 flex items-center justify-center transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
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
            <div
              ref={trendingScrollRef}
              className="-mx-4 sm:-mx-6 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 scroll-smooth pt-12 pb-8 [scrollbar-width:thin]"
            >
              {/* Side padding matches the negative margin: cards line up with the
                  heading while each card's glow has room to fade out */}
              <div className="flex w-max gap-5 px-4 sm:px-6">
                {trendingProps.map((prop, index) => (
                  <TrendingPropCard
                    key={`${prop.player}-${prop.prop_type}-${prop.line}`}
                    prop={prop}
                    rank={index + 1}
                    index={index}
                    onSelect={() => handleSelectPlayer({
                      name: prop.player,
                      betting_line: prop.line,
                      prop_type: prop.prop_type,
                      home_team: prop.home_team,
                      away_team: prop.away_team,
                      event_id: prop.event_id
                    })}
                  />
                ))}
              </div>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800/40 backdrop-blur-sm rounded-lg shadow-xl p-12 text-center border border-slate-700/50"
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

      <FeaturedPlayers
        players={playersWithLines}
        loading={loadingLines}
        onSelectPlayer={(line) => handleSelectPlayer({
          name: line.name,
          betting_line: line.betting_line,
          bookmaker: line.bookmaker,
          prop_type: line.prop_type,
          event_id: line.event_id,
          home_team: line.home_team,
          away_team: line.away_team
        })}
        user={user}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
      />

    </div>
  );
}

export default Home;
