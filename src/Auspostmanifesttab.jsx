import React, { useState } from 'react';

// Tab 3: shows every order that has a real shipment/label created in
// Tab 2, with its tracking number. Order numbers are clickable to
// re-download the label (fetches a fresh URL via the stored
// request_id, since the original may have expired). "Create Manifest"
// seals every ready shipment into one real AusPost order, downloads
// the order summary PDF, and updates DEAR -- all as one action, per
// spec. "Delete Shipment" removes the AusPost shipment and label, and
// returns the order to Tab 1.
export default function AusPostManifestTab({ csvQueue, processState, onRedownloadLabel, onDeleteShipment, onCreateManifestAndComplete }) {
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [orderReference, setOrderReference] = useState(`Order-${new Date().toISOString().slice(0, 10)}`);
  const [redownloadingFor, setRedownloadingFor] = useState(null);

  const orderNumberOf = (entry) => entry.order_data.OrderNumber || entry.order_data.orderName;

  // Only orders with a real shipment created belong on this tab --
  // anything still stuck on Tab 2 (not yet labelled) doesn't show here
  // at all, since there's nothing to manifest or delete for it yet.
  const readyQueue = csvQueue.filter((entry) => !!processState[orderNumberOf(entry)]?.shipmentId);

  const toggleSelected = (orderNumber) => {
    setSelectedNumbers((prev) => (prev.includes(orderNumber) ? prev.filter((n) => n !== orderNumber) : [...prev, orderNumber]));
  };
  const selectAll = () => setSelectedNumbers(readyQueue.map(orderNumberOf));
  const unselectAll = () => setSelectedNumbers([]);

  const handleRedownload = async (entry) => {
    const orderNumber = orderNumberOf(entry);
    setRedownloadingFor(orderNumber);
    await onRedownloadLabel(entry);
    setRedownloadingFor(null);
  };

  const handleDelete = async () => {
    const entries = readyQueue.filter((entry) => selectedNumbers.includes(orderNumberOf(entry)));
    if (entries.length === 0) return;
    if (!window.confirm(`Delete ${entries.length} shipment(s) and their labels? This returns the order(s) to Tab 1.`)) return;
    setBusy(true);
    await onDeleteShipment(entries);
    setSelectedNumbers([]);
    setBusy(false);
  };

  const handleCreateManifest = async () => {
    const entries = readyQueue.filter((entry) => selectedNumbers.includes(orderNumberOf(entry)));
    if (entries.length === 0) return;
    setBusy(true);
    await onCreateManifestAndComplete(entries, orderReference);
    setSelectedNumbers([]);
    setBusy(false);
  };

  const stageLabel = (stage) => {
    switch (stage) {
      case 'shipment_created': return { text: 'Shipment created', color: 'text-slate-600' };
      case 'label_created': return { text: '✅ Label ready', color: 'text-emerald-600' };
      case 'booked': return { text: '✅ Manifest booked', color: 'text-emerald-600' };
      case 'complete': return { text: '✅ Complete -- DEAR updated', color: 'text-emerald-700 font-bold' };
      case 'error': return { text: '⚠️ Error', color: 'text-red-600 font-bold' };
      default: return { text: stage || '—', color: 'text-slate-500' };
    }
  };

  if (readyQueue.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400 shadow-xs">
        No labelled shipments yet. Create labels for orders in Tab 2 first.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{readyQueue.length} labelled order(s)</span>
          <button onClick={selectAll} className="text-[11px] font-bold text-purple-600 hover:text-purple-800 cursor-pointer">Select All</button>
          <button onClick={unselectAll} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer">Unselect All</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={orderReference}
            onChange={(e) => setOrderReference(e.target.value)}
            placeholder="Manifest reference"
            className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 w-44"
          />
          <button
            onClick={handleDelete}
            disabled={busy || selectedNumbers.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-3 rounded-md cursor-pointer disabled:opacity-50"
          >
            🗑️ Delete Shipment ({selectedNumbers.length})
          </button>
          <button
            onClick={handleCreateManifest}
            disabled={busy || selectedNumbers.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-2 px-4 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Working...' : `📮 Create Manifest (${selectedNumbers.length})`}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-bold">
              <th className="p-3 w-8"></th>
              <th className="p-3">Order Number</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Service</th>
              <th className="p-3">Tracking Number</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {readyQueue.map((entry, idx) => {
              const orderNumber = orderNumberOf(entry);
              const s = processState[orderNumber] || {};
              const label = stageLabel(s.stage);
              const alreadyBooked = !!s.orderId;

              return (
                <tr key={idx} className="hover:bg-slate-50/80">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedNumbers.includes(orderNumber)}
                      onChange={() => toggleSelected(orderNumber)}
                      disabled={alreadyBooked}
                    />
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => handleRedownload(entry)}
                      disabled={redownloadingFor === orderNumber || !s.labelRequestId}
                      className="font-bold text-purple-600 hover:text-purple-800 cursor-pointer disabled:opacity-50 disabled:text-slate-400"
                      title="Click to re-download this order's label"
                    >
                      {redownloadingFor === orderNumber ? 'Downloading...' : orderNumber}
                    </button>
                  </td>
                  <td className="p-3 text-slate-700">{entry.order_data.Customer || entry.order_data.customer || '—'}</td>
                  <td className="p-3 text-slate-600">{entry.service}</td>
                  <td className="p-3 font-mono text-slate-600">{s.trackingNumber || '—'}</td>
                  <td className="p-3">
                    <span className={label.color} title={s.error || ''}>{label.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}