/**
 * What is influencing a pick, as a short list the site can show.
 *
 * Every prediction already sees these inputs (recent form, the line against
 * the player's averages, opponent allowances and pace, injuries on both
 * teams, rest, volatility, the early-season guard). This turns them into
 * labelled factors so a reader can see WHY the model leans the way it does
 * instead of a bare probability.
 *
 * Each factor:
 *   { key, label, effect, weight, detail }
 *   effect  'over' | 'under' | 'caution' | 'neutral'
 *   weight  1..3, how much it matters (drives the order shown)
 *   detail  one plain sentence with the numbers behind it
 *
 * The factors describe the inputs honestly; they are not the model's
 * arithmetic. The edge model's own verdict is the 'model' factor.
 */

const r1 = (x) => Math.round(x * 10) / 10;

// Opponent allowance keys per prop (edge_context, from teamContextService):
// the difference from league average in that stat allowed per game
const OPP_STAT = {
  points: [['opp_pts_allowed_rel', 'points', 2.0]],
  rebounds: [['opp_reb_allowed_rel', 'rebounds', 1.5]],
  assists: [['opp_ast_allowed_rel', 'assists', 1.0]],
  threes: [['opp_fg3m_allowed_rel', 'threes', 0.7]],
  pra: [['opp_pts_allowed_rel', 'points', 2.0], ['opp_reb_allowed_rel', 'rebounds', 1.5], ['opp_ast_allowed_rel', 'assists', 1.0]],
  pr: [['opp_pts_allowed_rel', 'points', 2.0], ['opp_reb_allowed_rel', 'rebounds', 1.5]],
  pa: [['opp_pts_allowed_rel', 'points', 2.0], ['opp_ast_allowed_rel', 'assists', 1.0]],
  ra: [['opp_reb_allowed_rel', 'rebounds', 1.5], ['opp_ast_allowed_rel', 'assists', 1.0]],
};

function gameDateOf(g) {
  const raw = g?.date || g?.game_date || g?.gameDate;
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

/**
 * @param {object} p
 * @param {string}   p.propType
 * @param {number}   p.line             consensus line
 * @param {object[]} p.games            game log, most recent first
 * @param {number[]} p.values           prop values for those games, most recent first
 * @param {object}   p.features         buildPropFeatures output
 * @param {object}   p.edgeContext      opponent / risk context (edge_context)
 * @param {object}   p.injuryData       { playerTeamInjuries, opponentInjuries }
 * @param {string}   p.playerName
 * @param {object}   p.caution          early-season guard output or null
 * @param {number}   p.modelValue       the model's own number
 * @param {number}   p.edgeResidual     capped model − line (edge path) or null
 * @param {string}   p.opponent
 * @param {object}   p.nextGameInfo
 */
export function buildPickFactors(p) {
  const { propType, line, games = [], values = [], features = {}, edgeContext = null, injuryData = null, playerName = '', caution = null, modelValue = null, edgeResidual = null, opponent = null, nextGameInfo = null } = p;
  if (!(line > 0)) return [];
  const out = [];
  const opp = opponent || edgeContext?.opponent || null;

  // 1. The model's own read of the line
  if (modelValue != null || edgeResidual != null) {
    const diff = edgeResidual != null ? edgeResidual : modelValue - line;
    const projected = edgeResidual != null ? line + edgeResidual : modelValue;
    const relDiff = Math.abs(diff) / line;
    const effect = Math.abs(diff) < 0.25 ? 'neutral' : diff > 0 ? 'over' : 'under';
    out.push({
      key: 'model', label: 'Model vs line', effect,
      weight: relDiff >= 0.1 ? 3 : relDiff >= 0.04 ? 2 : 1,
      detail: effect === 'neutral'
        ? `The model lands on the line (${r1(projected)} vs ${line}).`
        : `The model projects ${r1(projected)}, ${Math.abs(r1(diff))} ${diff > 0 ? 'above' : 'below'} the ${line} line.`,
    });
  }

  // 2. Recent form against the line
  const last5 = values.slice(0, 5);
  if (last5.length >= 3) {
    const avg5 = last5.reduce((s, v) => s + v, 0) / last5.length;
    const over5 = last5.filter(v => v > line).length;
    const last10 = values.slice(0, 10);
    const over10 = last10.filter(v => v > line).length;
    const rel = (avg5 - line) / line;
    const effect = over5 >= 4 && rel > 0.03 ? 'over' : over5 <= 1 && rel < -0.03 ? 'under' : 'neutral';
    out.push({
      key: 'form', label: 'Recent form', effect,
      weight: effect === 'neutral' ? 1 : Math.abs(rel) >= 0.12 ? 3 : 2,
      detail: `Averaging ${r1(avg5)} over the last ${last5.length}; cleared ${line} in ${over5} of ${last5.length}${last10.length > 5 ? ` and ${over10} of the last ${last10.length}` : ''}.`,
    });
  }

  // 3. Where the book set the line against the player's averages
  const seasonAvg = features.seasonAvg;
  if (seasonAvg > 0) {
    const ratio = line / seasonAvg;
    const far = ratio < 0.85 || ratio > 1.15;
    out.push({
      key: 'line', label: 'Line vs average', effect: far ? 'caution' : 'neutral',
      weight: far ? 2 : 1,
      detail: far
        ? `The ${line} line sits ${Math.round(Math.abs(ratio - 1) * 100)}% ${ratio > 1 ? 'above' : 'below'} the ${r1(seasonAvg)} average: the book is pricing something the averages do not show (role, minutes or matchup).`
        : `The ${line} line is close to the ${r1(seasonAvg)} average over the last ${features.gamesCount || values.length} games.`,
    });
  }

  // 4. Opponent defense for this stat
  const parts = OPP_STAT[propType] || [];
  if (edgeContext && parts.length) {
    const seen = parts.filter(([k]) => typeof edgeContext[k] === 'number');
    if (seen.length) {
      // Sum of per-stat differences, in units of the prop; threshold scales with it
      const diff = seen.reduce((s, [k]) => s + edgeContext[k], 0);
      const th = seen.reduce((s, [, , t]) => s + t, 0) * (seen.length > 1 ? 0.8 : 1);
      const effect = diff >= th ? 'over' : diff <= -th ? 'under' : 'neutral';
      const pieces = seen.map(([k, name]) => `${Math.abs(r1(edgeContext[k]))} ${edgeContext[k] >= 0 ? 'more' : 'fewer'} ${name}`);
      out.push({
        key: 'defense', label: `${opp || 'Opponent'} defense`, effect,
        weight: effect === 'neutral' ? 1 : Math.abs(diff) >= th * 1.8 ? 3 : 2,
        detail: `${opp || 'The opponent'} allows ${pieces.join(', ')} per game than league average${typeof edgeContext.opp_def_rating_rel === 'number' ? ` (defensive rating ${edgeContext.opp_def_rating_rel > 0 ? '+' : ''}${r1(edgeContext.opp_def_rating_rel)} vs league)` : ''}.`,
      });
    }
    if (typeof edgeContext.opp_pace_rel === 'number') {
      const pace = edgeContext.opp_pace_rel;
      const effect = pace >= 1.5 ? 'over' : pace <= -1.5 ? 'under' : 'neutral';
      out.push({
        key: 'pace', label: 'Game pace', effect, weight: effect === 'neutral' ? 1 : Math.abs(pace) >= 3 ? 2 : 1,
        detail: `${opp || 'The opponent'} plays ${Math.abs(r1(pace))} possessions per game ${pace >= 0 ? 'faster' : 'slower'} than average${effect === 'neutral' ? '' : pace > 0 ? ': more possessions, more chances' : ': fewer possessions to work with'}.`,
      });
    }
  }

  // 5. Injuries: the player, key teammates, key opponents
  const lastName = playerName.toLowerCase().split(' ').pop();
  const isSelf = (inj) => lastName && (inj.playerName || '').toLowerCase().includes(lastName);
  const teamInj = injuryData?.playerTeamInjuries || [];
  const oppInj = injuryData?.opponentInjuries || [];
  const self = teamInj.find(isSelf);
  if (self && self.structuredStatus && self.structuredStatus !== 'active') {
    const st = self.structuredStatus;
    out.push({
      key: 'injury', label: 'Injury status', effect: 'caution', weight: st === 'out' ? 3 : st === 'questionable' ? 2 : 1,
      detail: `Listed ${self.status || st}${self.injury && self.injury !== 'Not specified' ? ` (${self.injury})` : ''}${self.comment ? `: ${self.comment}` : '.'}`,
    });
  }
  // Rotation players (impact score 65+: roughly 20+ minutes a night) are
  // named; deeper bench absences are counted so nothing on the report is lost
  const ROTATION = 65;
  const byImpact = (a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0);
  const names = (l) => {
    const n = l.map(i => i.playerName);
    return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  };
  const teamOut = teamInj.filter(i => !isSelf(i) && i.structuredStatus === 'out').sort(byImpact);
  const keyOut = teamOut.filter(i => (i.impactScore ?? 0) >= ROTATION);
  const benchOut = teamOut.length - keyOut.length;
  const keyDoubt = teamInj.filter(i => !isSelf(i) && (i.structuredStatus === 'questionable' || i.structuredStatus === 'doubtful') && (i.impactScore ?? 0) >= ROTATION).sort(byImpact);
  if (keyOut.length || keyDoubt.length) {
    const top = keyOut.filter(i => (i.impactScore ?? 0) >= 80).length;
    // Not an over signal: the book raises the line when a star sits, and in
    // the graded record props with a key teammate out have gone over LESS
    // often (47.6% vs 49.3%, two out 41%). Shown as a caution: the role
    // changes and the line already prices it.
    out.push({
      key: 'teammates', label: 'Teammates out', effect: top ? 'caution' : 'neutral',
      weight: top >= 2 || keyOut.length >= 3 ? 3 : keyOut.length ? 2 : 1,
      detail: [
        keyOut.length ? `${names(keyOut)} ${keyOut.length > 1 ? 'are' : 'is'} out${benchOut ? ` (plus ${benchOut} deeper on the bench)` : ''}: more shots and minutes, but the line already prices that in.` : null,
        keyDoubt.length ? `${names(keyDoubt)} ${keyDoubt.length > 1 ? 'are' : 'is'} ${keyDoubt.every(i => i.structuredStatus === 'doubtful') ? 'doubtful' : 'questionable'}.` : null,
      ].filter(Boolean).join(' '),
    });
  }
  const oppOut = oppInj.filter(i => i.structuredStatus === 'out' && (i.impactScore ?? 0) >= ROTATION).sort(byImpact);
  const oppDoubt = oppInj.filter(i => (i.structuredStatus === 'questionable' || i.structuredStatus === 'doubtful') && (i.impactScore ?? 0) >= 80).sort(byImpact);
  if (oppOut.length || oppDoubt.length) {
    out.push({
      key: 'opp_injuries', label: `${opp || 'Opponent'} injuries`, effect: oppOut.length ? 'over' : 'neutral', weight: oppOut.length >= 2 ? 2 : 1,
      detail: [
        oppOut.length ? `${names(oppOut)} out for ${opp || 'the opponent'}, thinning the defense.` : null,
        oppDoubt.length ? `${names(oppDoubt)} ${oppDoubt.length > 1 ? 'are' : 'is'} questionable.` : null,
      ].filter(Boolean).join(' '),
    });
  }

  // 6. Rest and venue
  const lastDate = gameDateOf(games[0]);
  const nextRaw = nextGameInfo?.commence_time || nextGameInfo?.date;
  const nextDate = nextRaw ? new Date(nextRaw) : null;
  const isHome = edgeContext?.is_home ?? nextGameInfo?.isHome ?? null;
  if (lastDate && nextDate && !isNaN(nextDate.getTime()) && nextDate > lastDate) {
    const rest = Math.round((nextDate - lastDate) / 86400000);
    const b2b = rest <= 1;
    out.push({
      key: 'rest', label: 'Rest', effect: b2b ? 'under' : 'neutral', weight: b2b ? 2 : 1,
      detail: `${b2b ? 'Second night of a back-to-back' : `${rest - 1} day${rest - 1 === 1 ? '' : 's'} off`}${isHome != null ? `, ${isHome ? 'at home' : 'on the road'}` : ''}${b2b ? ': minutes and efficiency tend to dip.' : '.'}`,
    });
  } else if (isHome != null) {
    out.push({ key: 'rest', label: 'Venue', effect: 'neutral', weight: 1, detail: isHome ? 'Playing at home.' : 'Playing on the road.' });
  }

  // 7. Volatility
  if (typeof features.volatility === 'number' && features.stdDev != null) {
    const v = features.volatility;
    const high = v >= 45;
    out.push({
      key: 'volatility', label: 'Consistency', effect: high ? 'caution' : 'neutral', weight: high ? 2 : 1,
      detail: high
        ? `Swingy: a typical game lands anywhere within ±${r1(features.stdDev)} of the average, so either side can hit.`
        : v >= 30
          ? `Moderate: a typical game lands within ±${r1(features.stdDev)} of the average.`
          : `Steady: a typical game lands within ±${r1(features.stdDev)} of the average.`,
    });
  }

  // 8. Early-season guard
  if (caution) {
    const parts = [];
    if (caution.reasons?.includes('no_games_this_season')) parts.push('no games logged this season yet, so everything above comes from last season');
    else if (caution.leans_only) parts.push(`only ${caution.season_games} of the ${caution.min_games} games this season needed before the model makes picks`);
    if (caution.reasons?.includes('line_far_below_average') || caution.reasons?.includes('line_far_above_average')) parts.push('the line is far from the recent average, which points to a changed role');
    if (parts.length) { const text = parts.join('; '); out.push({ key: 'sample', label: 'Early season', effect: 'caution', weight: caution.leans_only ? 3 : 2, detail: `${text[0].toUpperCase()}${text.slice(1)}.` }); }
  }

  const order = { caution: 0, over: 1, under: 1, neutral: 2 };
  return out.sort((a, b) => b.weight - a.weight || order[a.effect] - order[b.effect]);
}
