import React, { useState } from 'react';
import Cin7Fulfillment from './Cin7Fulfillment';

export default function ShippingModule() {
  const [subTab, setSubTab] = useState('pantone'); // 'pantone' or 'shopify'

  return (
    <div className="space-y-4">
      {/* Sub-Section Switcher Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Shipping & Logistics Workspace</h2>
            <p className="text-xs text-slate-500">Dispatch sales orders via Pantone and sync Shopify orders</p>
          </div>
        </div>

        {/* Sub-Section Navigation Tabs */}
        <div className="flex border-b border-slate-200 gap-2">
          <button
            onClick={() => setSubTab('pantone')}
            className={`pb-2 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              subTab === 'pantone'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Pantone
          </button>

          <button
            onClick={() => setSubTab('shopify')}
            className={`pb-2 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              subTab === 'shopify'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Shopify
          </button>
        </div>
      </div>

      {/* Sub-Section 1: Pantone (Contains DEAR Core Fulfillment) */}
      {subTab === 'pantone' && <Cin7Fulfillment />}

      {/* Sub-Section 2: Shopify Integration */}
      {subTab === 'shopify' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
          <h3 className="font-bold text-slate-900 text-sm">Shopify Integration</h3>
          <p className="text-slate-500">Sync web orders, carrier rates, and store fulfillment status.</p>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
            Shopify store connections and unfulfilled web orders ready for layout.
          </div>
        </div>
      )}
    </div>
  );
}