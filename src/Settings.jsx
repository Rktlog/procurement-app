import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('lead_times');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);

  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [leadTimeMonths, setLeadTimeMonths] = useState(3.0);
  const [supplierSettings, setSupplierSettings] = useState([]);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadMsg, setLeadMsg] = useState(null);

  useEffect(() => {
    fetchSuppliersAndSettings();
  }, []);

  const fetchSuppliersAndSettings = async () => {
    setLeadLoading(true);
    try {
      const { data: supData } = await supabase.from('suppliers').select('id, name').order('name');
      setSuppliers(supData || []);

      const { data: setTemp } = await supabase.from('supplier_settings').select('*').order('supplier_name');
      setSupplierSettings(setTemp || []);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
    setLeadLoading(false);
  };

  const handleSupplierChange = (supId) => {
    setSelectedSupplierId(supId);
    const existing = supplierSettings.find(s => s.supplier_id === supId);
    setLeadTimeMonths(existing ? existing.lead_time_months : 3.0);
  };

  // Edit action
  const handleEditSetting = (setting) => {
    setSelectedSupplierId(setting.supplier_id);
    setLeadTimeMonths(setting.lead_time_months);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Delete action (removes custom lead time so it reverts back to default 3.0 months)
  const handleDeleteSetting = async (supplierId, supplierName) => {
    if (!window.confirm(`Are you sure you want to delete the custom lead time for "${supplierName}"? It will revert back to the 3.0-month default.`)) {
      return;
    }

    setLeadLoading(true);
    try {
      const { error } = await supabase
        .from('supplier_settings')
        .delete()
        .eq('supplier_id', supplierId);

      if (error) throw error;

      await supabase.rpc('refresh_longterm_summary');
      setLeadMsg({ type: 'success', text: `Removed lead time for ${supplierName}. Reverted to 3.0-month default.` });
      await fetchSuppliersAndSettings();
    } catch (err) {
      setLeadMsg({ type: 'error', text: err.message });
    }
    setLeadLoading(false);
  };

  const handleSaveLeadTime = async (e) => {
    e.preventDefault();
    setLeadMsg(null);

    if (!selectedSupplierId) return setLeadMsg({ type: 'error', text: 'Please select a supplier.' });

    const targetSupplier = suppliers.find(s => s.id === selectedSupplierId);
    if (!targetSupplier) return;

    setLeadLoading(true);
    try {
      const { error } = await supabase.from('supplier_settings').upsert({
        supplier_id: selectedSupplierId,
        supplier_name: targetSupplier.name,
        lead_time_months: parseFloat(leadTimeMonths) || 3.0,
        updated_at: new Date().toISOString()
      });

      if (error) throw error;

      await supabase.rpc('refresh_longterm_summary');
      setLeadMsg({ type: 'success', text: `Saved lead time for ${targetSupplier.name} (${leadTimeMonths} months)!` });
      await fetchSuppliersAndSettings();
    } catch (err) {
      setLeadMsg({ type: 'error', text: err.message });
    }
    setLeadLoading(false);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwdMsg(null);

    if (newPassword.length < 6) return setPwdMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
    if (newPassword !== confirmPassword) return setPwdMsg({ type: 'error', text: 'Passwords do not match.' });

    setPwdLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPwdMsg({ type: 'error', text: error.message });
    } else {
      setPwdMsg({ type: 'success', text: 'Password updated successfully!' });
      setNewPassword('');
      setConfirmPassword('');
    }
    setPwdLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">⚙️ System Settings</h2>
        <p className="text-xs text-slate-500">Configure vendor shipping lead times and credentials</p>

        <div className="flex border-b border-slate-200 mt-4 gap-6 text-xs font-bold">
          <button
            onClick={() => setActiveTab('lead_times')}
            className={`pb-2.5 transition-colors cursor-pointer ${activeTab === 'lead_times' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}
          >
            🚚 Supplier Lead Times
          </button>
          <button
            onClick={() => setActiveTab('password')}
            className={`pb-2.5 transition-colors cursor-pointer ${activeTab === 'password' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}
          >
            🔒 Account Password
          </button>
        </div>
      </div>

      {activeTab === 'lead_times' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Supplier Lead Time Override</h3>
            <p className="text-xs text-slate-500">All vendors default to <strong>3.0 months</strong> unless customized below.</p>

            {leadMsg && (
              <div className={`p-3.5 text-xs rounded-xl border ${leadMsg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                {leadMsg.text}
              </div>
            )}

            <form onSubmit={handleSaveLeadTime} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Supplier</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => handleSupplierChange(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300/80 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                >
                  <option value="">-- Select Vendor --</option>
                  {suppliers.map(sup => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Lead Time (Months)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="12"
                  value={leadTimeMonths}
                  onChange={(e) => setLeadTimeMonths(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300/80 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={leadLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-xl transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {leadLoading ? 'Saving...' : 'Save Lead Time'}
                </button>
              </div>
            </form>
          </div>

          {/* Configured Lead Times Table with Edit & Delete Actions */}
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase">Configured Lead Times</h3>
            {supplierSettings.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No custom overrides saved yet. All suppliers default to 3.0 months.</p>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Vendor Name</th>
                    <th className="p-3.5 text-center">Configured Lead Time</th>
                    <th className="p-3.5 text-center">Last Updated</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierSettings.map(setting => (
                    <tr key={setting.supplier_id} className="hover:bg-slate-50/80">
                      <td className="p-3.5 font-bold text-slate-800">{setting.supplier_name}</td>
                      <td className="p-3.5 text-center font-extrabold text-blue-700">{setting.lead_time_months} Month(s)</td>
                      <td className="p-3.5 text-center text-slate-400">{new Date(setting.updated_at).toLocaleDateString()}</td>
                      <td className="p-3.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleEditSetting(setting)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-300 transition-colors cursor-pointer"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteSetting(setting.supplier_id, setting.supplier_name)}
                            className="bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-200 transition-colors cursor-pointer"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'password' && (
        <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm max-w-md space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Change Password</h3>

          {pwdMsg && (
            <div className={`p-3.5 text-xs rounded-xl border ${pwdMsg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {pwdMsg.text}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full text-xs bg-slate-50 border border-slate-300/80 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full text-xs bg-slate-50 border border-slate-300/80 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={pwdLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-xl transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {pwdLoading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}