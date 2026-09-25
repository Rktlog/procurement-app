import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const AVAILABLE_APPS = [
  { id: 'procurement', label: 'Procurement Hub' },
  { id: 'shipping', label: 'Shipping & Logistics' },
];

export default function UserManagementAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // New User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newApps, setNewApps] = useState(['procurement']);
  const [newIsMaster, setNewIsMaster] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  // Multi-Select Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('user_roles').select('*').order('email');
    if (!error) setUsers(data || []);
    setLoading(false);
  };

  // Create User directly via Database RPC (Does NOT touch browser auth / session)
  const handleCreateUser = async (e) => {
    e.preventDefault();
    setMsg(null);

    if (!newEmail.trim() || !newPassword.trim()) {
      return setMsg({ type: 'error', text: 'Email and password are required.' });
    }

    if (newApps.length === 0) {
      return setMsg({ type: 'error', text: 'Select at least one assigned application.' });
    }

    setFormLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_new_user_by_admin', {
        new_email: newEmail.trim(),
        new_password: newPassword.trim(),
        is_master_flag: newIsMaster,
        assigned_apps_list: newApps,
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `User "${newEmail.trim()}" created successfully!` });
      setNewEmail('');
      setNewPassword('');
      setNewApps(['procurement']);
      setNewIsMaster(false);
      setIsDropdownOpen(false);
      await fetchUsers();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setFormLoading(false);
  };

  const toggleNewAppSelection = (appId) => {
    if (newApps.includes(appId)) {
      setNewApps(newApps.filter((id) => id !== appId));
    } else {
      setNewApps([...newApps, appId]);
    }
  };

  const handleToggleApp = async (userId, appCode, currentApps) => {
    const updatedApps = currentApps.includes(appCode)
      ? currentApps.filter((a) => a !== appCode)
      : [...currentApps, appCode];

    const { error } = await supabase
      .from('user_roles')
      .update({ assigned_apps: updatedApps, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (!error) await fetchUsers();
  };

  const handleToggleMaster = async (userId, currentMasterStatus) => {
    const { error } = await supabase
      .from('user_roles')
      .update({ is_master: !currentMasterStatus, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (!error) await fetchUsers();
  };

  const handleDeleteUserCompletely = async (userId, userEmail) => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete "${userEmail}"?`)) {
      return;
    }

    try {
      const { error } = await supabase.rpc('delete_user_completely', {
        target_user_id: userId,
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `User "${userEmail}" was deleted.` });
      await fetchUsers();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">➕ Add New User</h2>
          <p className="text-xs text-slate-500">Create user account directly without interrupting your session</p>
        </div>

        {msg && (
          <div
            className={`p-3 text-xs rounded-lg border ${
              msg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {msg.text}
          </div>
        )}

        <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@rocketlog.com.au"
              required
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white h-9"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 6 characters"
              required
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white h-9"
            />
          </div>

          {/* Multi-Select Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Apps</label>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-left font-medium text-slate-800 flex justify-between items-center focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer h-9"
            >
              <span className="truncate">
                {newApps.length === 0
                  ? '-- Select Apps --'
                  : newApps.map((id) => AVAILABLE_APPS.find((a) => a.id === id)?.label).join(', ')}
              </span>
              <span className="text-slate-400 text-[10px] ml-1">{isDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-1 space-y-0.5">
                {AVAILABLE_APPS.map((app) => {
                  const isChecked = newApps.includes(app.id);
                  return (
                    <div
                      key={app.id}
                      onClick={() => toggleNewAppSelection(app.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>{app.label}</span>
                      <span className="font-bold">{isChecked ? '✓' : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={formLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-lg transition-colors cursor-pointer disabled:opacity-50 h-9"
          >
            {formLoading ? 'Creating...' : 'Create User'}
          </button>
        </form>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-900 uppercase">Registered Users ({users.length})</h3>
          <button
            onClick={fetchUsers}
            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-center py-6 text-xs text-slate-400">Loading user records...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-3">User Email</th>
                  <th className="p-3 text-center">Master Admin</th>
                  <th className="p-3">App Access</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800">{u.email}</td>
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={u.is_master}
                        onChange={() => handleToggleMaster(u.user_id, u.is_master)}
                        className="rounded text-purple-600 border-slate-300 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {AVAILABLE_APPS.map((app) => {
                          const isAssigned = (u.assigned_apps || []).includes(app.id);
                          return (
                            <button
                              key={app.id}
                              onClick={() => handleToggleApp(u.user_id, app.id, u.assigned_apps || [])}
                              className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                                isAssigned
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-700'
                              }`}
                            >
                              {isAssigned ? '✓ ' : '+ '} {app.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteUserCompletely(u.user_id, u.email)}
                        className="text-red-600 hover:text-red-800 hover:bg-red-50 px-2.5 py-1 rounded text-[11px] font-bold border border-transparent hover:border-red-200 transition-colors cursor-pointer"
                      >
                        🗑️ Delete User
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}