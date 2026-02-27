import { motion } from 'framer-motion';

function LoadingAnimation({ message = "Loading player prediction..." }) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center justify-center min-h-[400px] space-y-6"
    >
      {/* Animated spinner with glow effect */}
      <div className="relative">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-16 h-16 border-4 border-gray-700 border-t-yellow-500 rounded-full"
        />
        <motion.div
          animate={{ 
            rotate: 360,
            scale: [1, 1.2, 1]
          }}
          transition={{ 
            rotate: { duration: 1, repeat: Infinity, ease: "linear" },
            scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
          }}
          className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-yellow-500/30 rounded-full"
        />
      </div>
      
      {/* Loading text with pulse */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-lg font-medium text-gray-300"
      >
        {message.split('').map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.1
            }}
          >
            {char === ' ' ? '\u00A0' : char}
          </motion.span>
        ))}
      </motion.p>
      
      {/* Animated dots with improved animation */}
      <div className="flex items-center justify-center space-x-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-3 h-3 bg-yellow-500 rounded-full"
            animate={{
              y: [0, -12, 0],
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{
              duration: 0.4,
              repeat: Infinity,
              delay: i * 0.2,
              ease: [0.4, 0, 0.6, 1]
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export default LoadingAnimation;

