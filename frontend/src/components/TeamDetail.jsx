import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Calendar, Shield, Target, AlertCircle, Newspaper, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { getTeamLogo, getTeamName } from '../utils/teamLogos';

const TABS = [
  { key: 'home', label: 'Home' },
  { key: 'stats', label: 'Stats' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'roster', label: 'Roster' },
  { key: 'injuries', label: 'Injuries' },
];

const OFFENSIVE_STATS = [
  { key: 'ppg', label: 'PPG' },
  { key: 'fgPct', label: 'FG%' },
  { key: 'threePtPct', label: '3P%' },
  { key: 'ftPct', label: 'FT%' },
  { key: 'apg', label: 'APG' },
  { key: 'topg', label: 'TOPG' },
];

const DEFENSIVE_STATS = [
  { key: 'rpg', label: 'RPG' },
  { key: 'offRpg', label: 'ORPG' },
  { key: 'defRpg', label: 'DRPG' },
  { key: 'spg', label: 'SPG' },
  { key: 'bpg', label: 'BPG' },
  { key: 'pfpg', label: 'PFPG' },
];

function TeamDetail() {
  const { abbreviation } = useParams();
  const navigate = useNavigate();
  const { user, isTeamFavorite, toggleFavoriteTeam } = useAuth();
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('home');

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
        <div className="h-10 bg-gray-800 rounded-lg animate-pulse" />
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
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {teamData?.record && (
                <span className="text-lg font-semibold text-yellow-400">{teamData.record}</span>
              )}
              {teamData?.standing && (
                <span className="text-sm text-gray-400">{teamData.standing}</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              {teamData?.homeRecord && <span>Home: {teamData.homeRecord}</span>}
              {teamData?.awayRecord && <span>Away: {teamData.awayRecord}</span>}
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

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-yellow-500 text-gray-900'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {t.label}
            {t.key === 'injuries' && teamData?.injuries?.length > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                tab === 'injuries' ? 'bg-gray-900/30 text-gray-900' : 'bg-red-500/20 text-red-400'
              }`}>
                {teamData.injuries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'home' && <HomeTab news={teamData?.news} nextGame={teamData?.nextGame} injuries={teamData?.injuries} navigate={navigate} abbreviation={abbreviation} />}
      {tab === 'stats' && <StatsTab stats={teamData?.stats} nextGame={teamData?.nextGame} navigate={navigate} />}
      {tab === 'schedule' && <ScheduleTab schedule={teamData?.schedule} teamAbbrev={abbreviation} navigate={navigate} />}
      {tab === 'roster' && <RosterTab roster={teamData?.roster} abbreviation={abbreviation} navigate={navigate} />}
      {tab === 'injuries' && <InjuriesTab injuries={teamData?.injuries} abbreviation={abbreviation} navigate={navigate} />}
    </div>
  );
}

function HomeTab({ news, nextGame, injuries, navigate, abbreviation }) {
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 1) return 'Just now';
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Next Game */}
      {nextGame && (
        <div
          onClick={() => navigate(`/games/${nextGame.id}`)}
          className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center justify-between cursor-pointer hover:border-yellow-500/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-white font-semibold">{nextGame.name}</p>
              <p className="text-xs text-gray-400">
                {new Date(nextGame.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(nextGame.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            </div>
          </div>
          <span className="text-xs text-gray-500 uppercase">Next Game</span>
        </div>
      )}

      {/* News */}
      {news?.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-yellow-400" />
            Latest News
          </h3>
          {news.map((article, i) => (
            <a
              key={i}
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex hover:border-gray-600 transition-colors group"
            >
              {article.image && (
                <img
                  src={article.image}
                  alt=""
                  className="w-28 sm:w-40 h-24 sm:h-28 object-cover flex-shrink-0"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              )}
              <div className="p-4 flex-1 min-w-0">
                <h4 className="text-white font-semibold text-sm line-clamp-2 group-hover:text-yellow-400 transition-colors">
                  {article.headline}
                </h4>
                <p className="text-gray-500 text-xs mt-1 line-clamp-2">{article.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-600">{timeAgo(article.published)}</span>
                  <ExternalLink className="w-3 h-3 text-gray-600" />
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
          <p className="text-gray-400">No recent news</p>
        </div>
      )}
    </motion.div>
  );
}

function StatsTab({ stats, nextGame, navigate }) {
  const hasStats = stats && Object.keys(stats).length > 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {nextGame && (
        <div
          onClick={() => navigate(`/games/${nextGame.id}`)}
          className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center justify-between cursor-pointer hover:border-yellow-500/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-white font-semibold">{nextGame.name}</p>
              <p className="text-xs text-gray-400">
                {new Date(nextGame.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(nextGame.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            </div>
          </div>
          <span className="text-xs text-gray-500 uppercase">Next Game</span>
        </div>
      )}

      {hasStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-yellow-400" />
              Offense
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {OFFENSIVE_STATS.map(({ key, label }) => (
                <div key={key} className="text-center">
                  <p className="text-xl font-bold text-white tabular-nums">{stats[key] || '-'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              Defense
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {DEFENSIVE_STATS.map(({ key, label }) => (
                <div key={key} className="text-center">
                  <p className="text-xl font-bold text-white tabular-nums">{stats[key] || '-'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!hasStats && !nextGame && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
          <p className="text-gray-400">No stats available</p>
        </div>
      )}
    </motion.div>
  );
}

function ScheduleTab({ schedule, teamAbbrev, navigate }) {
  if (!schedule?.length) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <p className="text-gray-400">No schedule data available</p>
      </div>
    );
  }

  // Split into past and upcoming
  const now = new Date();
  const past = schedule.filter(g => g.status === 'final').reverse();
  const upcoming = schedule.filter(g => g.status !== 'final');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-gray-700/50">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-3 py-3">Opponent</th>
              <th className="text-center px-3 py-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.length > 0 && (
              <>
                <tr><td colSpan={3} className="px-4 py-2 text-xs font-semibold text-yellow-400 bg-gray-800/50 uppercase tracking-wider">Upcoming</td></tr>
                {upcoming.slice(0, 10).map(game => (
                  <ScheduleRow key={game.id} game={game} teamAbbrev={teamAbbrev} navigate={navigate} />
                ))}
              </>
            )}
            {past.length > 0 && (
              <>
                <tr><td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-500 bg-gray-800/50 uppercase tracking-wider">Recent Results</td></tr>
                {past.slice(0, 15).map(game => (
                  <ScheduleRow key={game.id} game={game} teamAbbrev={teamAbbrev} navigate={navigate} />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

function ScheduleRow({ game, teamAbbrev, navigate }) {
  const abbrevUpper = teamAbbrev.toUpperCase();
  const isHome = game.home.abbrev === abbrevUpper || game.home.abbrev === teamAbbrev;
  const opponent = isHome ? game.away.abbrev : game.home.abbrev;
  const teamScore = isHome ? game.home.score : game.away.score;
  const oppScore = isHome ? game.away.score : game.home.score;
  const won = game.status === 'final' && parseInt(teamScore) > parseInt(oppScore);
  const lost = game.status === 'final' && parseInt(teamScore) < parseInt(oppScore);

  return (
    <tr
      onClick={() => navigate(`/games/${game.id}`)}
      className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer transition-colors"
    >
      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
        {new Date(game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs w-3">{isHome ? 'vs' : '@'}</span>
          <img src={getTeamLogo(opponent)} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
          <span className="text-white font-medium">{opponent}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {game.status === 'final' ? (
          <span className={`font-semibold tabular-nums ${won ? 'text-green-400' : lost ? 'text-red-400' : 'text-gray-400'}`}>
            {won ? 'W' : lost ? 'L' : 'T'} {teamScore}-{oppScore}
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            {new Date(game.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </span>
        )}
      </td>
    </tr>
  );
}

function RosterTab({ roster, abbreviation, navigate }) {
  if (!roster?.length) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <p className="text-gray-400">No roster data available</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
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
            {roster.map((player) => (
              <tr
                key={player.id}
                onClick={() => {
                  const nameSlug = encodeURIComponent(player.displayName.toLowerCase().replace(/\s+/g, '-'));
                  navigate(`/player/${player.id}/${nameSlug}`, {
                    state: { player: { id: player.id, first_name: player.firstName, last_name: player.lastName, position: player.position, team: { abbreviation } } },
                  });
                }}
                className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 sticky left-0 bg-gray-800">
                  <div className="flex items-center gap-3">
                    {player.headshot ? (
                      <img src={player.headshot} alt="" className="w-9 h-9 rounded-full object-cover bg-gray-700" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                        {player.displayName?.split(' ').map((n) => n[0]).join('')}
                      </div>
                    )}
                    <div>
                      <span className="text-white font-medium">{player.displayName}</span>
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
    </motion.div>
  );
}

function InjuriesTab({ injuries, abbreviation, navigate }) {
  if (!injuries?.length) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <AlertCircle className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">No injuries reported</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="space-y-0">
        {injuries.map((inj, i) => (
          <div
            key={i}
            onClick={() => {
              if (inj.id) {
                const slug = encodeURIComponent(inj.name.replace(/\s+/g, '_'));
                navigate(`/player/${inj.id}/${slug}`);
              }
            }}
            className="flex items-center justify-between px-5 py-4 border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              {inj.headshot ? (
                <img src={inj.headshot} alt="" className="w-10 h-10 rounded-full object-cover bg-gray-700" onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                  {(inj.name || '?')[0]}
                </div>
              )}
              <div>
                <p className="text-white font-medium">{inj.name}</p>
                <p className="text-xs text-gray-500">{inj.position}</p>
              </div>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded ${
              inj.status === 'Out' ? 'bg-red-500/20 text-red-400' :
              inj.status === 'Day-To-Day' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-gray-700 text-gray-400'
            }`}>
              {inj.status}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default TeamDetail;
