// Shared AusPost constants and helpers -- used by Cin7Fulfillment.jsx
// (Tabs 6/7, the CSV export path) and by the per-tab components
// (AusPostValidateTab.jsx, etc.). Kept in its own file specifically so
// neither the main file nor a tab component needs to import from the
// other just to reach these -- avoids a circular dependency.

// Fixed per-business settings for international shipments. Same values
// already used in this account's existing working implementation.
export const INTL_SENDER_BUSINESS = 'Rocket Logistics';
export const INTL_SENDER_EMAIL = 'logistics@rocketlog.com.au';
export const INTL_PRODUCT_ID = 'PTI7';
export const INTL_REASON_FOR_EXPORT = 'Commercial Sale of Goods (B2B)';
export const INTL_ITEM_ORIGIN = 'US';
export const INTL_ITEM_DESCRIPTION = 'Pantone Color Guide Book';
export const INTL_ITEM_HS_CODE = '9609100919';

// Confirmed real registered business address (Get Accounts, production
// account 0005303796) -- used as the "from" for every AusPost address
// validation, pricing check, and shipment creation.
export const SENDER_ADDRESS = {
  suburb: 'CAMPBELLFIELD',
  state: 'VIC',
  postcode: '3061',
};

export const COUNTRY_CODE_MAP = {
  'NEW ZEALAND': 'NZ', 'NZ': 'NZ',
  'AUSTRALIA': 'AU', 'AU': 'AU',
  'UNITED STATES': 'US', 'USA': 'US', 'UNITED STATES OF AMERICA': 'US',
};

// AusPost's international template wants a country CODE, not a full name.
export function normaliseCountryCode(rawCountry) {
  const key = (rawCountry || '').trim().toUpperCase();
  if (COUNTRY_CODE_MAP[key]) return COUNTRY_CODE_MAP[key];
  if (!key) return 'NZ'; // default destination for these shipments
  if (key.length === 2) return key; // already looks like a code
  return rawCountry;
}