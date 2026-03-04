import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, LogOut, Star, User, ChevronDown, Target, Users, Settings, Coins } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './components/Home';
import AuthModal from './components/AuthModal';
import UsernameModal from './components/UsernameModal';
import DailyBonusPopup from './components/DailyBonusPopup';

// Lazy load route components
const PlayerDetail = lazy(() => import('./components/PlayerDetail'));
const ModelPerformance = lazy(() => import('./components/ModelPerformance'));
const Favorites = lazy(() => import('./components/Favorites'));
const MyPredictions = lazy(() => import('./components/MyPredictions'));
const UserProfile = lazy(() => import('./components/UserProfile'));
const Friends = lazy(() => import('./components/Friends'));
const Leaderboard = lazy(() => import('./components/Leaderboard'));
const ProfileSettings = lazy(() => import('./components/ProfileSettings'));
const TeamDetail = lazy(() => import('./components/TeamDetail'));

function RouteLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <Suspense fallback={<RouteLoader />}>
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Home />
            </motion.div>
          }
        />
        <Route
          path="/performance"
          element={
            <motion.div
              key="performance"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <ModelPerformance />
            </motion.div>
          }
        />
        <Route
          path="/favorites"
          element={
            <motion.div
              key="favorites"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Favorites />
            </motion.div>
          }
        />
        <Route
          path="/predictions"
          element={
            <motion.div
              key="predictions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <MyPredictions />
            </motion.div>
          }
        />
        <Route
          path="/profile/:userId"
          element={
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <UserProfile />
            </motion.div>
          }
        />
        <Route
          path="/friends"
          element={
            <motion.div
              key="friends"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Friends />
            </motion.div>
          }
        />
        <Route
          path="/leaderboard"
          element={
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Leaderboard />
            </motion.div>
          }
        />
        <Route
          path="/settings"
          element={
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <ProfileSettings />
            </motion.div>
          }
        />
        <Route
          path="/player/:playerId/:playerName"
          element={
            <motion.div
              key="player-detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <PlayerDetail />
            </motion.div>
          }
        />
        <Route
          path="/team/:abbreviation"
          element={
            <motion.div
              key="team-detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <TeamDetail />
            </motion.div>
          }
        />
      </Routes>
    </AnimatePresence>
    </Suspense>
  );
}

function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, loading, tokens } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const menuRef = useRef(null);
  const userMenuRef = useRef(null);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    if (menuOpen || userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen, userMenuOpen]);

  // Close menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/performance', label: 'Model Performance', icon: '📊' },
    { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
    ...(user ? [
      { path: '/predictions', label: 'My Predictions', icon: '🎯' },
    ] : []),
  ];

  // Get user initial for avatar
  const userInitial = user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <>
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-gray-900 text-white py-4 shadow-lg border-b border-gray-800 sticky top-0 z-50 backdrop-blur-sm bg-gray-900/95"
      >
        <div className="container mx-auto px-4 flex items-center justify-between">
          {/* Left: Hamburger menu + Brand */}
          <div className="flex items-center gap-3" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-lg hover:bg-gray-800 transition-colors focus:outline-none"
              aria-label="Menu"
            >
              <div className="w-5 flex flex-col gap-1">
                <motion.span
                  animate={menuOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                  className="block h-0.5 w-5 bg-gray-300 rounded-full"
                />
                <motion.span
                  animate={menuOpen ? { opacity: 0 } : { opacity: 1 }}
                  className="block h-0.5 w-5 bg-gray-300 rounded-full"
                />
                <motion.span
                  animate={menuOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                  className="block h-0.5 w-5 bg-gray-300 rounded-full"
                />
              </div>
            </button>

            <motion.h1
              onClick={() => navigate('/')}
              className="text-2xl font-bold text-white cursor-pointer"
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              HoopForecast
            </motion.h1>

            {/* Dropdown menu */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-4 mt-1 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50"
                >
                  {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-yellow-500/10 text-yellow-400 font-semibold'
                            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        <span className="text-base">{item.icon}</span>
                        {item.label}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right: Auth */}
          <div className="flex items-center">
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
            ) : user ? (
                /* Logged in: avatar + dropdown */
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <Coins size={14} className="text-yellow-500" />
                    <span className="text-sm font-bold text-yellow-400">{tokens}</span>
                  </div>
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt=""
                        className="w-8 h-8 rounded-full border-2 border-gray-700"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center text-gray-900 font-bold text-sm">
                        {userInitial}
                      </div>
                    )}
                    <ChevronDown
                      size={16}
                      className={`text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50"
                      >
                        {/* User info */}
                        <div className="px-4 py-3 border-b border-gray-700">
                          <p className="text-sm font-semibold text-white truncate">
                            {user.displayName || 'User'}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{user.email}</p>
                        </div>

                        <button
                          onClick={() => navigate('/favorites')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                          <Star size={16} />
                          My Favorites
                        </button>
                        <button
                          onClick={() => navigate('/predictions')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                          <Target size={16} />
                          My Predictions
                        </button>
                        <button
                          onClick={() => navigate(`/profile/${user.uid}`)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                          <User size={16} />
                          My Profile
                        </button>
                        <button
                          onClick={() => navigate('/friends')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                          <Users size={16} />
                          Friends
                        </button>

                        <div className="border-t border-gray-700">
                          <button
                            onClick={() => navigate('/settings')}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                          >
                            <Settings size={16} />
                            Settings
                          </button>
                          <button
                            onClick={() => {
                              logout();
                              setUserMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
                          >
                            <LogOut size={16} />
                            Sign Out
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                </div>
              ) : (
                /* Logged out: Sign In button */
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-gray-900 rounded-lg font-semibold text-sm hover:bg-yellow-400 transition-colors"
                >
                  <LogIn size={16} />
                  Sign In
                </button>
              )}
          </div>
        </div>
      </motion.header>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <UsernameModal />
      <DailyBonusPopup />
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="min-h-screen bg-gray-900">
          <AppHeader />

          <main className="container mx-auto px-4 py-8 bg-gray-900 min-h-screen">
            <AnimatedRoutes />
          </main>

          <motion.footer
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="bg-gradient-to-br from-gray-900 to-gray-800 text-white py-8 border-t border-gray-700 mt-12"
          >
            <div className="container mx-auto px-4">
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-2">
                  <span className="font-semibold text-gray-300">Powered by:</span> XGBoost ML Models, ESPN API, NBA.com Stats, The Odds API & RapidAPI
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  Advanced machine learning predictions using gradient boosting algorithms
                </p>
                <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
                  <span>Real-time data from multiple sources</span>
                  <span>|</span>
                  <span>Historical stats & injury tracking</span>
                  <span>|</span>
                  <span>AI-powered performance analysis</span>
                </div>
                <p className="mt-4 text-xs text-gray-600 font-medium">
                  For informational and entertainment purposes only.
                </p>
              </div>
            </div>
          </motion.footer>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
