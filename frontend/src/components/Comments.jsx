import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { addComment, deleteComment, subscribeToComments } from '../services/firestoreService';

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const ms = timestamp?.toMillis?.() || timestamp?.seconds * 1000 || 0;
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Comments({ type, targetId, title = 'Comments' }) {
  const { user, openAuthModal } = useAuth();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    const unsubscribe = subscribeToComments(type, targetId, setComments);
    return () => unsubscribe();
  }, [type, targetId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim() || !user || submitting) return;
    setSubmitting(true);
    try {
      await addComment({
        type,
        gameId: type === 'game' ? targetId : null,
        playerId: type === 'player' ? targetId : null,
        userId: user.uid,
        userName: user.displayName || 'Anonymous',
        userPhoto: user.photoURL || null,
        text: text.trim(),
      });
      setText('');
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId) {
    try {
      await deleteComment(commentId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-yellow-400" />
        {title}
        {comments.length > 0 && (
          <span className="text-sm text-gray-400 font-normal">({comments.length})</span>
        )}
      </h3>

      {/* Input */}
      {user ? (
        <form onSubmit={handleSubmit} className="flex gap-3 mb-5">
          <div className="w-9 h-9 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-gray-300">
                {(user.displayName || 'A')[0].toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment..."
              maxLength={500}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
            />
            <button
              type="submit"
              disabled={!text.trim() || submitting}
              className="px-3 py-2 bg-yellow-500 text-gray-900 rounded-lg hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={openAuthModal}
          className="w-full mb-5 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
        >
          Sign in to comment
        </button>
      )}

      {/* Comments List */}
      {comments.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-6">No comments yet. Be the first!</p>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {comments.map((comment) => (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="flex gap-3 group"
              >
                <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center mt-0.5">
                  {comment.userPhoto ? (
                    <img src={comment.userPhoto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-gray-300">
                      {(comment.userName || 'A')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{comment.userName}</span>
                    <span className="text-xs text-gray-500">{timeAgo(comment.createdAt)}</span>
                    {user?.uid === comment.userId && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 mt-0.5 break-words">{comment.text}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
