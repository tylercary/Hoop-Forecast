import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Camera, User, Key, Trash2, Check, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function ProfileSettings() {
  const navigate = useNavigate();
  const { user, setUsername, updateProfilePhoto, changePassword, deleteAccount, logout } = useAuth();
  const fileInputRef = useRef(null);

  // Profile picture
  const [uploading, setUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoSuccess, setPhotoSuccess] = useState('');
  const [photoError, setPhotoError] = useState('');

  // Username
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [usernameError, setUsernameError] = useState('');

  // Password
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwError, setPwError] = useState('');

  // Delete account
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  if (!user) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700 text-center">
        <Settings className="mx-auto mb-4 text-gray-600" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">Sign in to access settings</h3>
        <p className="text-gray-400">You need to be logged in to manage your profile.</p>
      </div>
    );
  }

  const isEmailUser = user.providerData.some((p) => p.providerId === 'password');
  const userInitial = user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  // --- Photo handlers ---
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setPhotoError('Image must be under 2MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please select an image file');
      return;
    }
    setPhotoError('');
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoUpload = async () => {
    if (!photoFile) return;
    setUploading(true);
    setPhotoError('');
    try {
      await updateProfilePhoto(photoFile);
      setPhotoSuccess('Profile picture updated!');
      setPhotoFile(null);
      setPhotoPreview(null);
      setTimeout(() => setPhotoSuccess(''), 3000);
    } catch (err) {
      setPhotoError(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const cancelPhotoPreview = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Username handlers ---
  const handleUsernameSave = async () => {
    const trimmed = newUsername.trim();
    if (!trimmed || trimmed.length < 2) {
      setUsernameError('Username must be at least 2 characters');
      return;
    }
    if (trimmed.length > 20) {
      setUsernameError('Username must be 20 characters or less');
      return;
    }
    setUsernameSaving(true);
    setUsernameError('');
    try {
      await setUsername(trimmed);
      setUsernameSuccess('Username updated!');
      setEditingUsername(false);
      setNewUsername('');
      setTimeout(() => setUsernameSuccess(''), 3000);
    } catch (err) {
      setUsernameError(err.message || 'Failed to update username');
    } finally {
      setUsernameSaving(false);
    }
  };

  // --- Password handlers ---
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPw.length < 6) {
      setPwError('New password must be at least 6 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match');
      return;
    }
    setPwSaving(true);
    setPwError('');
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess('Password changed successfully!');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => setPwSuccess(''), 3000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setPwError('Current password is incorrect');
      } else {
        setPwError(msg.replace('Firebase: ', '') || 'Failed to change password');
      }
    } finally {
      setPwSaving(false);
    }
  };

  // --- Delete handlers ---
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount(isEmailUser ? deletePw : null);
      navigate('/');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setDeleteError('Incorrect password');
      } else {
        setDeleteError(msg.replace('Firebase: ', '') || 'Failed to delete account');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Settings className="text-yellow-500" size={24} />
        Profile Settings
      </h2>

      {/* Profile Picture */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Camera size={18} className="text-gray-400" />
          Profile Picture
        </h3>
        <div className="flex items-center gap-4">
          <div className="relative">
            {photoPreview ? (
              <img src={photoPreview} alt="Preview" className="w-20 h-20 rounded-full object-cover ring-2 ring-yellow-500" />
            ) : user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-20 h-20 rounded-full object-cover ring-2 ring-gray-600" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-yellow-500 flex items-center justify-center ring-2 ring-gray-600">
                <span className="text-gray-900 text-2xl font-bold">{userInitial}</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            {photoPreview ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePhotoUpload}
                  disabled={uploading}
                  className="px-4 py-2 bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Save Photo'}
                </button>
                <button
                  onClick={cancelPhotoPreview}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors"
              >
                Upload Photo
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="hidden"
            />
            <p className="text-xs text-gray-500">JPG, PNG or GIF. Max 2MB.</p>
          </div>
        </div>
        {photoError && <p className="text-red-400 text-sm mt-2">{photoError}</p>}
        {photoSuccess && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 text-sm mt-2 flex items-center gap-1">
            <Check size={14} /> {photoSuccess}
          </motion.p>
        )}
      </motion.div>

      {/* Username */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <User size={18} className="text-gray-400" />
          Username
        </h3>
        {editingUsername ? (
          <div className="space-y-3">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="New username"
              maxLength={20}
              autoFocus
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleUsernameSave}
                disabled={usernameSaving || !newUsername.trim()}
                className="px-4 py-2 bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
              >
                {usernameSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingUsername(false); setNewUsername(''); setUsernameError(''); }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
            {usernameError && <p className="text-red-400 text-sm">{usernameError}</p>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">{user.displayName || 'Not set'}</p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
            <button
              onClick={() => { setEditingUsername(true); setNewUsername(user.displayName || ''); }}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors"
            >
              Change
            </button>
          </div>
        )}
        {usernameSuccess && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 text-sm mt-2 flex items-center gap-1">
            <Check size={14} /> {usernameSuccess}
          </motion.p>
        )}
      </motion.div>

      {/* Password — only for email/password users */}
      {isEmailUser && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-gray-700 p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Key size={18} className="text-gray-400" />
            Change Password
          </h3>
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Current password"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
            />
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
            />
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
            />
            <button
              type="submit"
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="px-4 py-2 bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
            >
              {pwSaving ? 'Changing...' : 'Update Password'}
            </button>
            {pwError && <p className="text-red-400 text-sm">{pwError}</p>}
            {pwSuccess && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 text-sm flex items-center gap-1">
                <Check size={14} /> {pwSuccess}
              </motion.p>
            )}
          </form>
        </motion.div>
      )}

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-red-500/30 p-6"
      >
        <h3 className="text-lg font-semibold text-red-400 mb-2 flex items-center gap-2">
          <AlertTriangle size={18} />
          Danger Zone
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-semibold hover:bg-red-500/30 transition-colors"
        >
          <Trash2 size={14} className="inline mr-1.5" />
          Delete Account
        </button>
      </motion.div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80]"
              onClick={() => { setShowDeleteModal(false); setDeleteError(''); setDeleteConfirmText(''); setDeletePw(''); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[90] p-4"
            >
              <div className="bg-gray-800 border border-red-500/50 rounded-lg shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 space-y-4">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                      <AlertTriangle className="text-red-400" size={28} />
                    </div>
                    <h2 className="text-xl font-bold text-white">Delete Account</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      This will permanently delete your account, predictions, and friend connections.
                    </p>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Type DELETE to confirm</label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
                    />
                  </div>

                  {isEmailUser && (
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Enter your password</label>
                      <input
                        type="password"
                        value={deletePw}
                        onChange={(e) => setDeletePw(e.target.value)}
                        placeholder="Password"
                        className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
                      />
                    </div>
                  )}

                  {deleteError && <p className="text-red-400 text-sm">{deleteError}</p>}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowDeleteModal(false); setDeleteError(''); setDeleteConfirmText(''); setDeletePw(''); }}
                      className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting || deleteConfirmText !== 'DELETE' || (isEmailUser && !deletePw)}
                      className="flex-1 py-3 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-400 transition-colors disabled:opacity-50"
                    >
                      {deleting ? 'Deleting...' : 'Delete Forever'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ProfileSettings;
