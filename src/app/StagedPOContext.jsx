import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Items staged for a purchase order. Lives above the router so a selection
// made on Urgent or Long-term orders survives moving to Reorder & POs (or
// even to Shipping and back). Cin7Procurement clears it once a PO is sent.
const StagedPOContext = createContext(null);

export function StagedPOProvider({ children }) {
  const [items, setItems] = useState([]);

  // Merges by SKU: adding the same SKU twice adds the quantities together.
  const addItems = useCallback((newItems, source) => {
    setItems((prev) => {
      const merged = new Map(prev.map((i) => [i.SKU, { ...i }]));
      for (const item of newItems) {
        const existing = merged.get(item.SKU);
        if (existing) {
          existing.Quantity = (Number(existing.Quantity) || 0) + (Number(item.Quantity) || 0);
        } else {
          merged.set(item.SKU, { ...item, source });
        }
      }
      return [...merged.values()];
    });
  }, []);

  const removeItem = useCallback((sku) => setItems((prev) => prev.filter((i) => i.SKU !== sku)), []);
  const clearItems = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({ items, addItems, removeItem, clearItems }),
    [items, addItems, removeItem, clearItems]
  );
  return <StagedPOContext.Provider value={value}>{children}</StagedPOContext.Provider>;
}

export function useStagedPO() {
  const ctx = useContext(StagedPOContext);
  if (!ctx) throw new Error('useStagedPO must be used inside <StagedPOProvider>');
  return ctx;
}
