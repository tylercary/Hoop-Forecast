/**
 * How a calibrated over probability is shown to the viewer.
 *
 * 50 is the real zero, so the number that reads is the distance from even
 * ("+4"), not the probability ("54%"). The meter runs from the centre and is
 * full at FULL_SCALE points, which is where the model turns a lean into a
 * pick (56 over / 44 under in backend/config/pickThresholds.js).
 */
export const FULL_SCALE = 6;

/**
 * @param {number|null} overProbability  calibrated P(over) in percent
 * @param {boolean} isPick               the server made it a pick
 * @returns {{edge:number, side:'over'|'under'|null, fill:number, tier:string, label:string, percent:number}|null}
 *   edge     signed points from 50 (+ = over)
 *   fill     0..1 share of one half of the meter
 *   tier     'even' | 'slight' | 'lean' | 'strong' | 'pick'
 *   label    word for the tier, with the side ("Lean over")
 *   percent  the side's own probability, for the fine print
 */
export function describeLean(overProbability, isPick = false) {
  const p = Number(overProbability);
  if (!Number.isFinite(p)) return null;
  const edge = Math.round((p - 50) * 10) / 10;
  const abs = Math.abs(edge);
  const side = abs < 0.5 ? null : edge > 0 ? 'over' : 'under';
  let tier;
  if (isPick) tier = 'pick';
  else if (abs < 1) tier = 'even';
  else if (abs < 2) tier = 'slight';
  else if (abs < 4) tier = 'lean';
  else tier = 'strong';
  const word = { pick: 'Pick', even: 'Even', slight: 'Slight lean', lean: 'Lean', strong: 'Strong lean' }[tier];
  const label = side && tier !== 'even' ? `${word} ${side}` : word;
  return {
    edge,
    side,
    fill: Math.min(1, abs / FULL_SCALE),
    tier,
    label,
    percent: side === 'under' ? 100 - p : p,
  };
}

/** "+4" / "−3" / "0" for the big figure. */
export function formatEdge(edge) {
  if (!Number.isFinite(edge)) return '—';
  const rounded = Math.abs(edge) >= 10 ? Math.round(edge) : Math.round(edge * 10) / 10;
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `−${text}`;
  return '0';
}

/** Text colour for a lean's side and strength. */
export function leanColor(lean) {
  if (!lean || lean.tier === 'even') return 'text-slate-400';
  return lean.side === 'over' ? 'text-emerald-400' : 'text-rose-400';
}
