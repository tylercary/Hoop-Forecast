# HoopForecast v2

AI-powered NBA prop prediction platform with social features, virtual token wagering, and real-time sportsbook odds.

![HoopForecast v2](https://img.shields.io/badge/version-2.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![React](https://img.shields.io/badge/React-18-blue)

## Features

### Predictions
- **XGBoost ML Models** — Trained gradient boosting models for every prop type (points, assists, rebounds, 3PM, steals, blocks, and combos like PRA, P+R, P+A, R+A)
- **Real-Time Odds** — Live betting lines from 10+ sportsbooks via The Odds API
- **Prop Analysis** — Prediction vs. line comparison with bet rating, confidence score, and error margin
- **Trending Props** — Homepage highlights the highest-confidence AI picks across all games

### Social & Wagering
- **User Accounts** — Firebase Auth with Google sign-in and custom usernames
- **OVER/UNDER Picks** — Pick any prop, wager virtual tokens, and track your record
- **Token Economy** — 50 free tokens daily, odds-based payouts on wins, +10 for correct free picks
- **Leaderboard** — Global rankings by win rate, total wins, picks, or token balance
- **Friends** — Send/accept friend requests and view friends' profiles
- **Community Picks** — See what percentage of users picked OVER vs UNDER on each prop

### Player Pages
- **Game Log Table** — Recent games with stats, sortable columns, and color-coded performance
- **Prediction Chart** — Interactive Recharts visualization of recent performance vs. prediction line
- **Prop Odds Table** — Side-by-side sportsbook odds comparison with logos
- **Injury Reports** — Real-time injury data for both teams in the matchup
- **Favorites** — Star players for quick access from your profile

### Performance
- **Lazy-loaded routes** — React.lazy() code splitting for all route components
- **Vendor chunk splitting** — Firebase, Recharts, and Framer Motion in separate cached bundles
- **Backend compression** — gzip compression on all API responses
- **Static asset caching** — 7-day browser cache for player images and logos
- **Image lazy loading** — Offscreen images deferred with `loading="lazy"`

## Tech Stack

**Frontend:** React 18, Vite, Tailwind CSS, Framer Motion, Recharts, Firebase Auth
**Backend:** Node.js, Express, XGBoost (via Python bridge), node-cache
**Database:** Firebase Firestore (predictions, users, friendships)
**APIs:** ESPN, NBA.com, The Odds API, RapidAPI (injuries)

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Tyler-Cary/Hoop-Forecast-v2.git
cd Hoop-Forecast-v2

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Environment Variables

**backend/.env**
```env
ODDS_API_KEY=your_odds_api_key
RAPIDAPI_KEY=your_rapidapi_key
PORT=5001
```

**frontend/.env**
```env
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Run

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open **http://localhost:3000**

## Project Structure

```
├── backend/
│   ├── ml/                    # XGBoost models and training scripts
│   │   ├── models/            # Trained models per prop type
│   │   ├── train_xgboost.py   # Training pipeline
│   │   └── predict_xgboost.py # Prediction inference
│   ├── routes/
│   │   ├── playerRoutes.js    # Player data, predictions, resolution
│   │   ├── trendingRoutes.js  # Trending props endpoint
│   │   └── searchRoutes.js    # Player search
│   ├── services/
│   │   ├── oddsService.js     # The Odds API integration
│   │   ├── nbaApiService.js   # ESPN & NBA.com APIs
│   │   ├── injuryService.js   # RapidAPI injury reports
│   │   ├── propPredictionService.js  # ML prediction orchestration
│   │   └── imageStorageService.js    # Player image management
│   ├── middleware/
│   │   └── optionalAuth.js    # Firebase token verification
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Home.jsx           # Homepage with trending props & player grid
│   │   │   ├── PlayerDetail.jsx   # Full player analysis page
│   │   │   ├── MyPredictions.jsx  # User's pick history with wagers
│   │   │   ├── Leaderboard.jsx    # Global rankings
│   │   │   ├── Friends.jsx        # Friend management
│   │   │   └── ...
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx    # Auth, tokens, favorites state
│   │   ├── services/
│   │   │   └── firestoreService.js # Firestore CRUD operations
│   │   └── App.jsx
│   └── vite.config.js
└── README.md
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/player/with-lines` | Players with active betting lines |
| `GET /api/player/:id/compare` | Full player analysis (stats, prediction, odds, injuries) |
| `GET /api/player/:id/prediction/:propType` | ML prediction for a specific prop |
| `POST /api/player/resolve-predictions` | Resolve pending user picks with actual results |
| `GET /api/trending/props` | Top confidence AI picks |
| `GET /api/search?q=name` | Search players by name |
| `GET /api/performance` | Model accuracy metrics |

## Token Wagering

| Action | Tokens |
|--------|--------|
| Daily login bonus | +50 |
| Correct pick (no wager) | +10 |
| Correct pick (with wager) | +wager + profit (odds-based) |
| Push | Wager refunded |
| Loss | Wager lost |
| New account | 50 starting tokens |

Payout formula uses American odds:
- Positive odds: `profit = wager * (odds / 100)`
- Negative odds: `profit = wager * (100 / |odds|)`

## License

ISC

## Disclaimer

For entertainment purposes only. Predictions are not guaranteed. Always gamble responsibly.
