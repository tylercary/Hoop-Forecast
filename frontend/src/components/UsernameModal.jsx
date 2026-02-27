import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function UsernameModal() {
  const { needsUsername, setUsername, user } = useAuth();
  const [name, setName] = useState('');

  // Pre-fill with existing display name (e.g. from Google) so user can keep or change it
  useEffect(() => {
    if (needsUsername && user?.displayName) {
      setName(user.displayName);
    }
  }, [needsUsername, user?.displayName]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }
    if (trimmed.length > 20) {
      setError('Username must be 20 characters or less');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await setUsername(trimmed);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Error setting username:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {needsUsername && user && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 flex items-center justify-center z-[90] p-4"
          >
            <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-6">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-yellow-500 flex items-center justify-center mx-auto mb-3">
                    <User className="text-gray-900" size={28} />
                  </div>
                  <h2 className="text-xl font-bold text-white">Choose a Username</h2>
                  <p className="text-sm text-gray-400 mt-1">This is how other users will see you</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter username"
                      autoFocus
                      maxLength={20}
                      className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
                    />
                  </div>

                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-400 text-sm"
                    >
                      {error}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="w-full py-3 bg-yellow-500 text-gray-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Continue'}
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default UsernameModal;
