import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { resolveImageUrl } from '../utils/api';

/**
 * Injuries for both teams in the next game, split by team, with the impact
 * score the predictions use shown as a tier so a reader can tell a star from
 * a two-way player at a glance. Rotation-level players (impact 65+) are
 * listed in full; deeper bench absences collapse into one line.
 *
 * Statuses follow the official report: Out, Doubtful, Questionable,
 * Probable. The summary line at the top is built the same way the
 * "What's driving this pick" factors are, so the two never disagree.
 */

const ROTATION = 65;

function PlayerImageWithFallback({ playerName, playerId, headshot }) {
  const normalizedName = playerName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim();
  const localImageUrl = resolveImageUrl(`/images/players/${normalizedName}.png`);
  const cdnImageUrl = playerId ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png` : null;
  const initials = playerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const chain = [headshot, localImageUrl, cdnImageUrl].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const src = chain[idx];
  if (!src) {
    return <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-400 text-[11px] font-semibold shrink-0">{initials}</div>;
  }
  return <img src={src} alt={playerName} onError={() => setIdx(i => i + 1)} className="w-9 h-9 rounded-full object-cover border border-slate-600 shrink-0" />;
}

const STATUS = {
  out: { text: 'Out', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/40' },
  doubtful: { text: 'Doubtful', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/40' },
  questionable: { text: 'Questionable', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/40' },
  probable: { text: 'Probable', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
  unknown: { text: 'Listed', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/40' },
};

function statusOf(inj) {
  const raw = (inj.status || '').toLowerCase();
  if (raw.includes('doubtful')) return 'doubtful';
  if (raw.includes('out')) return 'out';
  if (raw.includes('questionable') || raw.includes('day-to-day') || raw.includes('dtd') || raw.includes('game time')) return 'questionable';
  if (raw.includes('probable') || raw.includes('available')) return 'probable';
  const s = inj.structuredStatus;
  return STATUS[s] ? s : 'unknown';
}

function tierOf(score) {
  if (score == null) return null;
  if (score >= 88) return { text: 'Star', cls: 'text-amber-300' };
  if (score >= 78) return { text: 'Starter', cls: 'text-slate-200' };
  if (score >= ROTATION) return { text: 'Rotation', cls: 'text-slate-400' };
  return { text: 'Bench', cls: 'text-slate-500' };
}

function reasonOf(inj) {
  // The report's full reason reads better than the extracted type when it
  // has one ("Injury/Illness - Left Ankle Fracture" -> "Left ankle fracture")
  const raw = inj.comment || inj.description || '';
  const stripped = raw.replace(/^injury\s*\/\s*illness\s*-\s*/i, '').trim();
  const text = stripped || inj.injury || 'Not specified';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

const fmtDate = (d) => {
  if (!d) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function Row({ inj, index }) {
  const st = STATUS[statusOf(inj)];
  const tier = tierOf(inj.impactScore);
  const reported = fmtDate(inj.date);
  return (
    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.03 }}
      className="flex items-center gap-3 py-2.5 border-b border-slate-800/80 last:border-0">
      <PlayerImageWithFallback playerName={inj.playerName} playerId={inj.playerId} headshot={inj.headshot} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">{inj.playerName}</span>
          {tier && <span className={`text-[10px] font-semibold uppercase tracking-wide ${tier.cls}`}>{tier.text}</span>}
        </div>
        <div className="text-xs text-slate-400 truncate">
          {reasonOf(inj)}{reported ? <span className="text-slate-600"> · {reported}</span> : null}
        </div>
      </div>
      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${st.cls}`}>{st.text}</span>
    </motion.li>
  );
}

function TeamColumn({ team, label, injuries, delay }) {
  const [showBench, setShowBench] = useState(false);
  const list = [...(injuries || [])].sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
  const rotation = list.filter(i => (i.impactScore ?? 0) >= ROTATION);
  const bench = list.filter(i => (i.impactScore ?? 0) < ROTATION);
  const out = list.filter(i => ['out', 'doubtful'].includes(statusOf(i))).length;
  const maybe = list.filter(i => statusOf(i) === 'questionable').length;
  const summary = list.length === 0 ? 'No one listed'
    : [out ? `${out} out` : null, maybe ? `${maybe} questionable` : null].filter(Boolean).join(' · ') || `${list.length} listed`;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="rounded-lg bg-slate-800/40 border border-slate-700/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-200">{team || '—'}</span>
          {label && <span className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</span>}
        </div>
        <span className={`text-xs ${out ? 'text-slate-300' : 'text-slate-500'}`}>{summary}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-slate-500 py-3">Nobody on the injury report.</p>
      ) : (
        <ul>
          {rotation.map((inj, i) => <Row key={`${inj.playerName}-${i}`} inj={inj} index={i} />)}
          {showBench && bench.map((inj, i) => <Row key={`b-${inj.playerName}-${i}`} inj={inj} index={rotation.length + i} />)}
          {bench.length > 0 && (
            <li className="pt-2">
              <button type="button" onClick={() => setShowBench(v => !v)} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
                <ChevronDown size={13} className={`transition-transform ${showBench ? 'rotate-180' : ''}`} />
                {showBench ? 'Hide bench' : `${bench.length} more on the bench${rotation.length === 0 ? ' (no rotation players listed)' : ''}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </motion.div>
  );
}

function InjuriesTable({ injuries, playerTeam, opponentTeam }) {
  const own = injuries?.player_team?.injuries || [];
  const opp = injuries?.opponent?.injuries || [];
  const ownTeam = injuries?.player_team?.team || playerTeam || null;
  const oppTeam = injuries?.opponent?.team || opponentTeam || null;

  const keyOut = (list) => list.filter(i => ['out', 'doubtful'].includes(statusOf(i)) && (i.impactScore ?? 0) >= 78).length;
  const headline = (() => {
    if (!own.length && !opp.length) return 'Nobody on either injury report';
    const a = keyOut(own), b = keyOut(opp);
    const parts = [];
    if (ownTeam) parts.push(a ? `${ownTeam} missing ${a} starter${a > 1 ? 's' : ''}` : `${ownTeam} at full strength up top`);
    if (oppTeam) parts.push(b ? `${oppTeam} missing ${b} starter${b > 1 ? 's' : ''}` : `${oppTeam} at full strength up top`);
    return parts.join(' · ');
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="panel p-6">
      <div className="mb-4">
        <h3 className="panel-title mb-1">Injuries</h3>
        <p className="panel-subtitle">{headline} · Star, Starter and Rotation reflect each player's impact score</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TeamColumn team={ownTeam} label="Player's team" injuries={own} delay={0.05} />
        <TeamColumn team={oppTeam} label="Opponent" injuries={opp} delay={0.1} />
      </div>
    </motion.div>
  );
}

export default InjuriesTable;
