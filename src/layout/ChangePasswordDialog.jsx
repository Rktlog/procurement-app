import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../supabaseClient';

// Lets any signed-in person change their own password. Opened from the
// account menu (the email at the top right).
export default function ChangePasswordDialog({ open, onClose }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const firstField = useRef(null);

  // Start clean every time it opens.
  useEffect(() => {
    if (!open) return;
    setNewPassword('');
    setConfirmPassword('');
    setMsg(null);
    setLoading(false);
    setTimeout(() => firstField.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (newPassword.length < 6) return setMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
    if (newPassword !== confirmPassword) return setMsg({ type: 'error', text: 'Passwords do not match.' });

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) return setMsg({ type: 'error', text: error.message });

    setMsg({ type: 'success', text: 'Password updated.' });
    setNewPassword('');
    setConfirmPassword('');
  };

  const done = msg?.type === 'success';
  const inputClass =
    'w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-[0.95rem] focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pw-title">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white shadow-lg p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
        >
          <X size={18} />
        </button>

        <h2 id="pw-title" className="page-title text-[1.5rem] text-ink">Change password</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">Choose a new password for your account.</p>

        {msg && (
          <div
            role={msg.type === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              msg.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {msg.text}
          </div>
        )}

        {!done && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="pw-new" className="block text-sm font-semibold text-ink mb-1">New password</label>
              <input
                id="pw-new"
                ref={firstField}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="pw-confirm" className="block text-sm font-semibold text-ink mb-1">Confirm new password</label>
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[0.95rem] disabled:opacity-60 cursor-pointer"
            >
              {loading ? 'Updating' : 'Update password'}
            </button>
          </form>
        )}

        {done && (
          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-lg border border-slate-300 bg-white text-[0.95rem] font-semibold text-ink hover:bg-slate-50 cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}