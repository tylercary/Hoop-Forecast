"""
Edge-model feature construction, shared by training (train_edge_model.py) and
the lockstep test. Every function here has a line-for-line twin in JavaScript:

    derived_features     <-> mlPredictionService.buildEdgeRow
    market_features      <-> mlPredictionService.marketFeatures
    opponent_context     <-> teamContextService.opponentContext
    risk_features        <-> mlPredictionService.riskFeatures
    minutes_under_share  <-> buildMLFeatures (min_under25_share_10)

Missing information is None (JSON null); XGBoost treats it as a missing value
on both sides. Change one side only together with the other.

    python3 backend/ml/edge_features.py --check <file.json>
        file: { "row": <JS edge row>, "prop", "line", "feature_vector", "context", "team_game_stats" }
        recomputes the context features here and reports any mismatch.
"""

import json
import math
import sys

PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra']
STAT_PARTS = {
    'points': ['pts'], 'rebounds': ['reb'], 'assists': ['ast'], 'threes': ['threes'],
    'pra': ['pts', 'reb', 'ast'], 'pr': ['pts', 'reb'], 'pa': ['pts', 'ast'], 'ra': ['reb', 'ast'],
}
# Opponent allowance that matters for each stat part
OPP_PART_KEY = {'pts': 'opp_pts_allowed_rel', 'reb': 'opp_reb_allowed_rel', 'ast': 'opp_ast_allowed_rel', 'threes': 'opp_fg3m_allowed_rel'}

MARKET_KEYS = ['mkt_over_prob', 'mkt_line_spread', 'mkt_n_books', 'mkt_pinnacle_minus_line', 'mkt_line_minus_mean']
OPPONENT_KEYS = ['opp_pts_allowed_rel', 'opp_reb_allowed_rel', 'opp_ast_allowed_rel', 'opp_fg3m_allowed_rel',
                 'opp_pace_rel', 'opp_def_rating_rel', 'opp_games_n', 'opp_stat_allowed_rel']
RISK_KEYS = ['game_spread_abs', 'teammates_out_key']
FAMILIES = {'market': MARKET_KEYS, 'opponent': OPPONENT_KEYS + ['is_home'], 'risk': RISK_KEYS + ['min_under25_share_10']}

SHRINK_GAMES = 20
LEAGUE_MIN_ROWS = 100


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def r3(x):
    return None if x is None else round(x * 1000) / 1000


# ---------------------------------------------------------------- market

def market_features(market, line):
    """market: the stored summary (marketFeatureService.summarizeMarket) or None."""
    out = {k: None for k in MARKET_KEYS}
    if not market:
        return out
    out['mkt_over_prob'] = _num(market.get('over_prob_novig'))
    out['mkt_line_spread'] = _num(market.get('line_spread'))
    out['mkt_n_books'] = _num(market.get('n_books'))
    pin = _num(market.get('pinnacle_line'))
    out['mkt_pinnacle_minus_line'] = None if pin is None else round((pin - line) * 100) / 100
    mean_line = _num(market.get('line_mean'))
    out['mkt_line_minus_mean'] = None if mean_line is None else round((line - mean_line) * 1000) / 1000
    return out


# -------------------------------------------------------------- opponent

def season_for_date(date_str):
    year, month = int(date_str[:4]), int(date_str[5:7])
    start = year if month >= 10 else year - 1
    return f'{start}-{str(start + 1)[-2:]}'


def previous_season(season):
    start = int(season.split('-')[0]) - 1
    return f'{start}-{str(start + 1)[-2:]}'


_STAT_KEYS = ['opp_pts', 'opp_reb', 'opp_ast', 'opp_fg3m']


def _means_of(rows):
    if not rows:
        return None
    out = {'n': len(rows)}
    for k in _STAT_KEYS:
        out[k] = sum(r[k] for r in rows) / len(rows)
    out['pace'] = sum(r['poss'] for r in rows) / len(rows)
    poss = sum(r['poss'] for r in rows)
    out['def_rating'] = 100 * sum(r['opp_pts'] for r in rows) / poss if poss > 0 else None
    return out


def _blend(cur, prev, n, k):
    if cur and prev:
        w = min(1.0, n / k)
        out = {'n': n}
        for key in _STAT_KEYS + ['pace', 'def_rating']:
            if cur[key] is None or prev[key] is None:
                out[key] = cur[key] if cur[key] is not None else prev[key]
            else:
                out[key] = w * cur[key] + (1 - w) * prev[key]
        return out
    return cur or prev or None


def opponent_context(opponent, as_of_date, data):
    """Twin of teamContextService.opponentContext (without opp_stat_allowed_rel)."""
    keys = OPPONENT_KEYS[:-1]
    empty = {k: None for k in keys}
    opp = (opponent or '').upper()
    date = str(as_of_date or '')[:10]
    if not opp or not date or not data or not data.get('seasons'):
        return empty
    season = season_for_date(date)
    cur_rows = [g for g in data['seasons'].get(season, {}).get('games', []) if g['d'] < date]
    prev_rows = data['seasons'].get(previous_season(season), {}).get('games', [])
    team_cur = _means_of([g for g in cur_rows if g['t'] == opp])
    team_prev = _means_of([g for g in prev_rows if g['t'] == opp])
    team = _blend(team_cur, team_prev, team_cur['n'] if team_cur else 0, SHRINK_GAMES)
    league_cur = _means_of(cur_rows) if len(cur_rows) >= LEAGUE_MIN_ROWS else None
    league = league_cur or _means_of(prev_rows)
    if not team or not league:
        return empty

    def rel(k):
        if team[k] is None or league[k] is None:
            return None
        return round((team[k] - league[k]) * 1000) / 1000

    return {
        'opp_pts_allowed_rel': rel('opp_pts'), 'opp_reb_allowed_rel': rel('opp_reb'),
        'opp_ast_allowed_rel': rel('opp_ast'), 'opp_fg3m_allowed_rel': rel('opp_fg3m'),
        'opp_pace_rel': rel('pace'), 'opp_def_rating_rel': rel('def_rating'),
        'opp_games_n': team_cur['n'] if team_cur else 0,
    }


def opponent_features(ctx, prop):
    """ctx: dict with the opponent_context keys (or nothing). Adds the prop-specific sum."""
    out = {k: (_num(ctx.get(k)) if ctx else None) for k in OPPONENT_KEYS[:-1]}
    parts = [out[OPP_PART_KEY[p]] for p in STAT_PARTS[prop]]
    out['opp_stat_allowed_rel'] = None if any(v is None for v in parts) else r3(sum(parts))
    return out


# ------------------------------------------------------------------ risk

def risk_features(ctx):
    ctx = ctx or {}
    return {'game_spread_abs': _num(ctx.get('game_spread_abs')), 'teammates_out_key': _num(ctx.get('teammates_out_key'))}


def minutes_under_share(minutes_recent_last, threshold=25, n=10):
    """Share of the last n games under `threshold` minutes; minutes oldest first."""
    last = [m for m in minutes_recent_last[-n:]]
    if not last:
        return 0.0
    return sum(1 for m in last if (m or 0) < threshold) / len(last)


# --------------------------------------------------------------- the row

def derived_features(fv, prop, line, ctx=None):
    """Line-relative + context features. Twin of buildEdgeRow (minus the base copy)."""
    ctx = ctx or {}
    out = {}
    for win in ('3', '5', '10', 'season'):
        out[f'stat_avg_{win}'] = sum(float(fv.get(f'{part}_avg_{win}', 0) or 0) for part in STAT_PARTS[prop])
    out['line'] = line
    out['line_minus_avg10'] = line - out['stat_avg_10']
    out['line_minus_avg5'] = line - out['stat_avg_5']
    out['line_minus_season'] = line - out['stat_avg_season']
    out['line_over_avg10'] = line / max(out['stat_avg_10'], 0.5)
    for p in PROPS:
        out[f'prop_{p}'] = 1 if p == prop else 0
    out.update(market_features(ctx.get('market'), line))
    out.update(opponent_features(ctx.get('opponent'), prop))
    out.update(risk_features(ctx.get('risk')))
    return out


def _check(path):
    with open(path) as f:
        case = json.load(f)
    fv = case['feature_vector']
    ctx = dict(case['context'])
    ctx['opponent'] = opponent_context(case['opponent'], case['game_date'], case['team_game_stats'])
    expected = derived_features(fv, case['prop'], float(case['line']), ctx)
    expected['min_under25_share_10'] = minutes_under_share(case['minutes_oldest_first'])
    row = case['row']
    problems = []
    for k, v in expected.items():
        if k not in row:
            problems.append(f'{k}: missing from JS row')
        elif (v is None) != (row[k] is None):
            problems.append(f'{k}: python {v!r} vs js {row[k]!r}')
        elif v is not None and abs(float(v) - float(row[k])) > 1e-6:
            problems.append(f'{k}: python {v!r} vs js {row[k]!r}')
    for k in fv:
        if k not in row:
            problems.append(f'{k}: base feature missing from JS row')
    print(json.dumps({'ok': not problems, 'checked': len(expected), 'problems': problems}))
    sys.exit(0 if not problems else 1)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--check':
        _check(sys.argv[2])
    else:
        print(__doc__)
