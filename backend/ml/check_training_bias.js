/**
 * Check if training data has OVER/UNDER bias
 */
import fs from 'fs/promises';

const DATA_FILE = 'data/training_features.csv';

async function checkBias() {
  console.log('Loading training data...\n');
  
  const content = await fs.readFile(DATA_FILE, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  const headers = lines[0].split(',');
  const ptsAvgIndex = headers.indexOf('pts_avg_10');
  const targetPtsIndex = headers.indexOf('target_pts');
  
  let totalGames = 0;
  let overCount = 0;
  let underCount = 0;
  let pushCount = 0;
  
  for (let i = 1; i < Math.min(lines.length, 5000); i++) {
    const values = lines[i].split(',');
    const avg10 = parseFloat(values[ptsAvgIndex]);
    const actual = parseFloat(values[targetPtsIndex]);
    
    if (isNaN(avg10) || isNaN(actual)) continue;
    
    totalGames++;
    const diff = actual - avg10;
    
    if (diff > 0.5) overCount++;
    else if (diff < -0.5) underCount++;
    else pushCount++;
  }
  
  console.log('Training Data Analysis (first 5000 games):');
  console.log('='.repeat(50));
  console.log(`Total games: ${totalGames}`);
  console.log(`OVER (actual > 10-game avg): ${overCount} (${(overCount/totalGames*100).toFixed(1)}%)`);
  console.log(`UNDER (actual < 10-game avg): ${underCount} (${(underCount/totalGames*100).toFixed(1)}%)`);
  console.log(`PUSH: ${pushCount} (${(pushCount/totalGames*100).toFixed(1)}%)`);
  console.log('='.repeat(50));
  
  if (underCount > overCount * 1.2) {
    console.log('\n⚠️  BIAS DETECTED: Training data has more UNDER outcomes!');
    console.log('This explains why the model always predicts UNDER.');
  } else {
    console.log('\n✅ Training data looks balanced.');
  }
}

checkBias().catch(console.error);
