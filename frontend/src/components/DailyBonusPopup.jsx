import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function DailyBonusPopup() {
  const { dailyBonusClaimed, dismissDailyBonus } = useAuth();

  useEffect(() => {
    if (!dailyBonusClaimed) return;
    const timer = setTimeout(dismissDailyBonus, 4000);
    return () => clearTimeout(timer);
  }, [dailyBonusClaimed, dismissDailyBonus]);

  return (
    <AnimatePresence>
      {dailyBonusClaimed && (
        <motion.div
          initial={{ opacity: 0, y: -40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          onClick={dismissDailyBonus}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] cursor-pointer"
        >
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-gradient-to-r from-yellow-500/90 to-amber-500/90 shadow-lg shadow-yellow-500/25 border border-yellow-400/50 backdrop-blur-sm">
            <Coins size={22} className="text-gray-900" />
            <div>
              <p className="text-sm font-bold text-gray-900">+50 Tokens</p>
              <p className="text-xs text-gray-800/80">Daily bonus claimed!</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default DailyBonusPopup;
