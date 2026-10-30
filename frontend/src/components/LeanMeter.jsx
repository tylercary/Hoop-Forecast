import { motion } from 'framer-motion';

/**
 * A meter centred on even money. The fill grows from the middle toward the
 * lean's side and is full when the lean would become a pick.
 * `lean` is the object from describeLean(); `muted` dims it for locked cards.
 */
export default function LeanMeter({ lean, muted = false, labels = true, delay = 0 }) {
  const fill = lean ? lean.fill : 0;
  const side = lean?.side;
  const bar = side === 'over' ? 'bg-emerald-500' : side === 'under' ? 'bg-rose-500' : 'bg-slate-500';
  return (
    <div className={muted ? 'opacity-30' : ''}>
      <div className="relative h-1.5 rounded-full bg-slate-700/60">
        <div className="absolute left-1/2 top-1/2 -translate-x-px -translate-y-1/2 h-3 w-0.5 rounded bg-slate-500" />
        {side && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${fill * 50}%` }}
            transition={{ delay, duration: 0.3, ease: 'easeOut' }}
            className={`absolute top-0 h-full ${bar} ${
              side === 'over' ? 'left-1/2 rounded-r-full' : 'right-1/2 rounded-l-full'
            }`}
          />
        )}
      </div>
      {labels && (
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>Under</span>
          <span>Even</span>
          <span>Over</span>
        </div>
      )}
    </div>
  );
}
