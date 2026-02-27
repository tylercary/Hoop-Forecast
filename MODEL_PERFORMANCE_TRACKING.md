# 📊 Model Performance Tracking System

## Overview

The Model Performance Tracking system allows you to track the accuracy of predictions made by the ML models, calculate hit rates, and display performance metrics to users.

---

## ✨ Features

### 1. **Overall Performance Metrics**
- Total predictions tracked
- Hit rate percentage (overall accuracy)
- Number of hits vs misses
- Pending predictions (awaiting game results)

### 2. **Performance by Prop Type**
- Breakdown by category (Points, Assists, Rebounds, etc.)
- Individual hit rates for each prop type
- Visual progress bars showing accuracy
- Total predictions per category

### 3. **Recent Predictions History**
- Last 20 tracked predictions
- Player name, prop type, and date
- Prediction vs actual results
- Visual indicators (✅ Hit, ❌ Miss, ⏰ Pending)

---

## 🏗️ Architecture

### Backend Components

#### 1. **Performance Tracking Service**
[performanceTrackingService.js](backend/services/performanceTrackingService.js)

**Functions:**
- `trackPrediction(predictionData)` - Save a new prediction
- `updatePredictionResult(predictionId, actualValue)` - Mark prediction with actual result
- `calculatePerformance()` - Calculate overall and per-prop hit rates
- `getPlayerPredictions(playerName)` - Get predictions for a specific player
- `getPredictionsByDate(date)` - Get predictions for a specific date
- `cleanupOldPredictions()` - Delete predictions older than 90 days

**Storage:**
- Uses JSON file storage at `/backend/data/predictions.json`
- Can be upgraded to database (PostgreSQL, MongoDB, etc.) later
- In-memory caching with 5-minute TTL

#### 2. **Performance Routes**
[performanceRoutes.js](backend/routes/performanceRoutes.js)

**Endpoints:**
- `GET /api/performance` - Get overall performance metrics
- `GET /api/performance/player/:playerName` - Get predictions for a player
- `GET /api/performance/date/:date` - Get predictions for a date
- `POST /api/performance/track` - Track a new prediction
- `PUT /api/performance/update/:id` - Update prediction with actual result
- `POST /api/performance/cleanup` - Clean up old predictions

### Frontend Components

#### 1. **ModelPerformance Component**
[ModelPerformance.jsx](frontend/src/components/ModelPerformance.jsx)

Displays:
- Overall hit rate card
- Performance breakdown by prop type
- Recent predictions table
- Loading and error states

---

## 🔄 Workflow

### Phase 1: Track Prediction
When a user views a prediction, track it:

```javascript
// When prediction is generated
const predictionData = {
  playerName: "LeBron James",
  playerId: "2544",
  propType: "points",
  prediction: 27.3,
  bettingLine: 25.5,
  coverProbability: 68.5,
  gameDate: "2026-02-12",
  opponent: "GSW",
  team: "LAL"
};

// Track the prediction
await fetch('http://localhost:5001/api/performance/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(predictionData)
});
```

### Phase 2: Update with Actual Result
After the game completes, update with actual stats:

```javascript
// Get the actual game result
const actualPoints = 31; // LeBron scored 31 points

// Update the prediction
await fetch(`http://localhost:5001/api/performance/update/${predictionId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ actualValue: actualPoints })
});

// System automatically determines:
// - Prediction: 27.3
// - Line: 25.5
// - Actual: 31
// - Result: HIT (31 >= 25.5)
```

### Phase 3: View Performance
Users can view performance metrics on the homepage:

- Overall hit rate: 67.2%
- Points predictions: 65.8% (45/68 hits)
- Assists predictions: 71.4% (20/28 hits)
- Rebounds predictions: 62.5% (15/24 hits)

---

## 📝 Data Structure

### Prediction Object
```json
{
  "id": "1707654321000-abc123xyz",
  "playerName": "LeBron James",
  "playerId": "2544",
  "propType": "points",
  "prediction": 27.3,
  "bettingLine": 25.5,
  "coverProbability": 68.5,
  "gameDate": "2026-02-12",
  "opponent": "GSW",
  "team": "LAL",
  "timestamp": "2026-02-11T18:30:00.000Z",
  "actual": 31,
  "result": "hit",
  "isResolved": true
}
```

### Performance Response
```json
{
  "overall": {
    "total": 142,
    "hits": 95,
    "misses": 47,
    "hitRate": 66.9,
    "pending": 12
  },
  "byPropType": {
    "points": {
      "total": 68,
      "hits": 45,
      "misses": 23,
      "hitRate": 66.2
    },
    "assists": {
      "total": 28,
      "hits": 20,
      "misses": 8,
      "hitRate": 71.4
    }
  },
  "recentPredictions": [...]
}
```

---

## 🚀 Implementation Steps

### Step 1: Integrate Tracking into Prediction Flow

Add tracking to [PlayerDetail.jsx](frontend/src/components/PlayerDetail.jsx):

```javascript
// After prediction is generated
useEffect(() => {
  if (predictionData && predictionData.prediction) {
    trackPrediction({
      playerName: player.name,
      playerId: player.id,
      propType: selectedProp,
      prediction: predictionData.prediction,
      bettingLine: predictionData.bettingLine,
      coverProbability: predictionData.coverProbability,
      gameDate: predictionData.nextGame?.date,
      opponent: predictionData.nextGame?.opponent,
      team: predictionData.team
    });
  }
}, [predictionData]);
```

### Step 2: Create Update Script for Past Games

Create a script to fetch actual results and update predictions:

```javascript
// backend/scripts/updatePredictionResults.js
import { getPredictionsByDate } from '../services/performanceTrackingService.js';
import { fetchGameStats } from '../services/statsService.js';

// Get today's predictions
const today = new Date().toISOString().split('T')[0];
const predictions = getPredictionsByDate(today);

// For each prediction, fetch actual stats
for (const pred of predictions) {
  const actualStats = await fetchGameStats(pred.playerName, today);
  const actualValue = actualStats[pred.propType];

  await updatePredictionResult(pred.id, actualValue);
}
```

### Step 3: Schedule Daily Updates

Add to `package.json`:

```json
{
  "scripts": {
    "update-predictions": "node scripts/updatePredictionResults.js"
  }
}
```

Run daily via cron:
```bash
# Run at 2 AM every day
0 2 * * * cd /Applications/Project/backend && npm run update-predictions
```

---

## 📊 Current Status

### ✅ Implemented
- [x] Backend tracking service with JSON storage
- [x] Performance calculation with caching
- [x] API endpoints for tracking and retrieval
- [x] Frontend ModelPerformance component
- [x] Visual metrics display with charts
- [x] Recent predictions table

### 🔜 Next Steps (To Do)
- [ ] Integrate tracking into PlayerDetail component
- [ ] Create automated result update script
- [ ] Set up daily cron job for updates
- [ ] Add manual "Mark Result" UI for admins
- [ ] Upgrade to database storage (PostgreSQL)
- [ ] Add export to CSV functionality
- [ ] Add date range filters (Last 7 days, Last 30 days, etc.)
- [ ] Add player-specific performance page

---

## 🧪 Testing

### Manual Testing

**1. Track a prediction:**
```bash
curl -X POST http://localhost:5001/api/performance/track \
  -H "Content-Type: application/json" \
  -d '{
    "playerName": "LeBron James",
    "propType": "points",
    "prediction": 27.3,
    "bettingLine": 25.5,
    "gameDate": "2026-02-12",
    "opponent": "GSW",
    "team": "LAL"
  }'
```

**2. Update with result:**
```bash
curl -X PUT http://localhost:5001/api/performance/update/PREDICTION_ID \
  -H "Content-Type: application/json" \
  -d '{"actualValue": 31}'
```

**3. View performance:**
```bash
curl http://localhost:5001/api/performance
```

### Sample Data

To test with sample data, create predictions and mark them:

```bash
# Track 10 predictions
# Mark 7 as hits, 3 as misses
# View dashboard at http://localhost:3000
```

---

## 💡 Usage Tips

1. **Build Trust**: Display hit rate prominently to show model accuracy
2. **Be Transparent**: Show both hits and misses honestly
3. **Filter by Prop**: Let users see accuracy for specific props they care about
4. **Update Regularly**: Run result updates daily after games complete
5. **Clean Old Data**: Periodically clean predictions older than 90 days

---

## 🎯 Benefits

1. **User Trust**: Shows users the model is accurate and reliable
2. **Model Improvement**: Identify which props the model performs best/worst on
3. **Value Demonstration**: Proves the predictions have real value
4. **Marketing**: "67% hit rate over last 100 predictions" is powerful
5. **Debugging**: Helps identify patterns in model errors

---

## 📁 Files Created

- `/backend/services/performanceTrackingService.js` - Core tracking logic
- `/backend/routes/performanceRoutes.js` - API endpoints
- `/backend/data/predictions.json` - Prediction storage (auto-generated)
- `/frontend/src/components/ModelPerformance.jsx` - Performance dashboard

---

**All infrastructure is in place!** 🎉

Next step: Integrate tracking into the prediction flow and create the automated update script.
