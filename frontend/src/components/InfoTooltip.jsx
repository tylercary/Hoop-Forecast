import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Simple, reliable info tooltip component
 * Always appears above the icon, shifted left to stay on screen
 */
function InfoTooltip({ text, label, id }) {
  const [isHovered, setIsHovered] = useState(false);
  const uniqueId = id || `tooltip-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex items-center justify-center focus:outline-none hover:opacity-80 transition-opacity"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label={text || 'Information'}
      >
        <svg
          className={`w-[14px] h-[14px] transition-colors duration-200 ${
            isHovered ? 'text-gray-300' : 'text-gray-500'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* Tooltip - appears above and to the left */}
      <AnimatePresence mode="wait">
        {isHovered && (
          <motion.div
            key={uniqueId}
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute bottom-full right-0 mb-2 pointer-events-none z-[9999]"
            style={{
              width: '300px',
            }}
          >
            <div
              className="text-white text-sm rounded-lg px-4 py-3 shadow-2xl border border-gray-600 relative"
              style={{
                backgroundColor: '#1f2937',
              }}
            >
              {label && (
                <div className="font-semibold mb-1.5 text-white text-sm">
                  {label}
                </div>
              )}
              <div className="text-gray-300 leading-relaxed text-xs">
                {text}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default InfoTooltip;
