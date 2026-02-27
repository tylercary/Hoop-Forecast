# 🧪 Model Backtesting Guide

Test your ML model's accuracy by running predictions on recent completed games!

## Quick Start

```bash
cd backend
node scripts/backtestModel.js "Player Name" [numGames]
```

### Examples

```bash
# Test LeBron James's last 10 games
node scripts/backtestModel.js "LeBron James" 10

# Test Stephen Curry's last 15 games
node scripts/backtestModel.js "Stephen Curry" 15

# Test Luka Doncic's last 10 games (default)
node scripts/backtestModel.js "Luka Doncic"
```

## How It Works

1. **Fetches Player Data**: Searches for the player and gets their recent game history
2. **Makes Predictions**: For each completed game, generates predictions for all prop types:
   - Points
   - Assists
   - Rebounds
   - 3-Pointers Made
   - Steals
   - Blocks

3. **Compares to Actual Results**: Checks if the prediction hit or missed
4. **Tracks Performance**: Saves all predictions to the performance tracking system
5. **Shows Statistics**: Displays overall and per-prop hit rates

## Output Example

```
🏀 Backtesting model for: LeBron James
📊 Testing against last 10 completed games

1️⃣  Searching for player...
   ✅ Found: LeBron James (LAL)

2️⃣  Fetching game history...
   ✅ Found 10 recent completed games

3️⃣  Making predictions and comparing to actual results...

   📅 Game 1: vs GSW on Feb 10, 2026
      ✅ points: Predicted 27.3 (OVER) | Actual 31 | Line 25.5
      ❌ assists: Predicted 6.2 (UNDER) | Actual 8 | Line 7.5
      ✅ rebounds: Predicted 8.1 (OVER) | Actual 9 | Line 7.5
      ...

📈 BACKTEST RESULTS
═══════════════════════════════════════════════════════
Player: LeBron James
Games Tested: 10
Total Predictions: 52
Hits: 34
Misses: 18
Overall Hit Rate: 65.4%
═══════════════════════════════════════════════════════

📊 BREAKDOWN BY PROP TYPE

🟢 points         : 70.0% (7/10)
🟡 assists        : 60.0% (6/10)
🟢 rebounds       : 80.0% (8/10)
🔴 threes         : 40.0% (4/10)
🟡 steals         : 50.0% (5/10)
🟢 blocks         : 66.7% (4/6)
```

## Benefits

### ✅ Validate Model Accuracy
- See how well your model predicts against real completed games
- Identify which prop types the model performs best on

### 📊 Track Performance
- All backtested predictions are saved to the performance tracking system
- View them on the frontend at: http://localhost:3000

### 🎯 Identify Improvements
- If hit rate is low (<50%), the model needs improvement
- If hit rate is good (>60%), the model is working well

### ⚡ Fast Testing
- Test 10 games in seconds instead of waiting days for games to complete
- Test multiple players quickly

## Hit Rate Benchmarks

- **🟢 Excellent**: 65%+ hit rate
- **🟡 Good**: 55-65% hit rate
- **🟠 Fair**: 50-55% hit rate
- **🔴 Poor**: <50% hit rate

*Note: Professional sports betting models typically aim for 55-60% hit rate to be profitable*

## Tips

1. **Test Multiple Players**: Run backtests on 5-10 different players to get a broader view
2. **Test Different Positions**: Guards vs Centers may have different accuracy
3. **Test Recent Games**: Use last 10-15 games for most recent model performance
4. **Check Prop Types**: Some props (like points) are easier to predict than others (like steals)

## Performance Notes

The backtest script includes built-in delays to avoid overwhelming the NBA.com API:
- **500ms delay** between each prop prediction
- **1 second delay** between each game

This means backtesting 10 games with 6 prop types will take approximately 1-2 minutes. This is intentional to avoid rate limiting.

## Troubleshooting

### "Player not found"
- Check spelling of player name
- Use full name: "LeBron James" not "Lebron"

### "No game history found"
- Player may not have recent games
- Try a different player who has played recently

### "Connection refused" or "ECONNREFUSED"
- Make sure the backend server is running: `npm run dev`
- Check that server is on port 5001

### "Request timeout" or "NBA.com API is slow"
- NBA.com API may be temporarily down or rate-limiting
- Wait a few minutes and try again
- Try testing fewer games at once (e.g., 5 instead of 10)
- Avoid running multiple backtest scripts simultaneously

## Next Steps

After backtesting:
1. Review the hit rates for each prop type
2. If hit rate is good (>60%), the model is ready to use
3. If hit rate is poor (<50%), consider:
   - Improving feature engineering
   - Adding more training data
   - Tuning model hyperparameters
   - Using ensemble methods

## Advanced Usage

### Test Multiple Players

Create a bash script:

```bash
#!/bin/bash
players=("LeBron James" "Stephen Curry" "Luka Doncic" "Nikola Jokic" "Giannis Antetokounmpo")

for player in "${players[@]}"; do
  echo "Testing $player..."
  node scripts/backtestModel.js "$player" 10
  echo ""
done
```

### Export Results

Redirect output to a file:

```bash
node scripts/backtestModel.js "LeBron James" 10 > backtest_results.txt
```

---

**Happy Testing!** 🏀📊
