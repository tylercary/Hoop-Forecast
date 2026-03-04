import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import InfoTooltip from './InfoTooltip';

/**
 * Reusable metric card component for prop analysis
 * Supports a `locked` prop to blur values and show a sign-in prompt
 */

function PropMetricCard({ title, value, subtitle, color = 'text-white', icon, infoTooltip, infoTooltipLabel, progressBar, customValue, valueSize = 'text-3xl', index = 0, unified = true, locked = false, onSignIn }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: index * 0.03,
        duration: 0.2,
        ease: "easeOut"
      }}
      whileHover={unified ? undefined : { y: -2, transition: { duration: 0.1 } }}
      className={`${unified
        ? "p-4 sm:p-6 flex-1 min-w-0 relative"
        : "bg-gray-800 rounded-lg shadow-xl p-4 sm:p-6 border border-gray-700 flex-1 min-w-0 hover:border-gray-600 transition-colors"
      }${locked ? ' cursor-pointer' : ''}`}
      onClick={locked && onSignIn ? onSignIn : undefined}
    >
      {/* Minimal divider - only show if not the first item and in unified mode */}
      {unified && index > 0 && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-px h-[60%] bg-gray-600"></div>
      )}
      <div className="flex items-center gap-1.5 mb-2 min-h-[24px]">
        <span className="text-sm text-gray-400 font-medium leading-tight">{title}</span>
        {infoTooltip && !locked && (
          <InfoTooltip text={infoTooltip} label={infoTooltipLabel} id={`tooltip-${title}`} />
        )}
        {locked && <Lock size={12} className="text-gray-500" />}
      </div>

      {locked ? (
        <div className="relative h-10 flex items-center justify-center">
          <div className="absolute inset-0 select-none blur-md opacity-40 pointer-events-none flex items-center justify-center">
            <div className={`${valueSize} font-bold text-gray-400`}>
              {customValue ? '—' : '88.8%'}
            </div>
          </div>
          <span className="relative text-xs text-gray-400 font-medium bg-gray-800/80 px-2 py-1 rounded z-10">
            Sign in to view
          </span>
        </div>
      ) : (
        <>
          {/* Progress Bar (for Cover Probability) */}
          {progressBar != null && (
            <div className="mb-3">
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.max(0, progressBar))}%` }}
                  transition={{ delay: index * 0.03 + 0.05, duration: 0.3, ease: "easeOut" }}
                  className={`h-3 rounded-full ${
                    progressBar > 60 ? 'bg-green-500' :
                    progressBar >= 50 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                />
              </div>
            </div>
          )}

          {customValue ? (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: index * 0.03 + 0.05, duration: 0.2 }}
              className="mb-1"
            >
              {customValue}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 + 0.05, duration: 0.2 }}
              className={`${valueSize} font-bold ${color} mb-1 break-words leading-tight`}
            >
              {value || 'N/A'}
            </motion.div>
          )}
          {subtitle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.03 + 0.1, duration: 0.2 }}
              className="text-xs text-gray-400 mt-1"
            >
              {subtitle}
            </motion.div>
          )}
          {icon && (
            <div className="mt-2">
              {icon}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

export default PropMetricCard;
