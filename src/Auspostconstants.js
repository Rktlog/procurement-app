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

// Confirmed via AusPost's real documentation: valid label layouts are
// A4-1pp, A4-3pp, A4-4pp, and A6-1pp. The layout must also be valid for
// the product type of the items in the shipment -- worth keeping in
// mind if a future product ever rejects A6 specifically.
export const LABEL_LAYOUT_A6 = 'A6-1pp';
export const LABEL_LAYOUT_A4 = 'A4-1pp';
export const INTL_REASON_FOR_EXPORT = 'Commercial Sale of Goods (B2B)';
export const INTL_ITEM_ORIGIN = 'US';
export const INTL_ITEM_DESCRIPTION = 'Pantone Color Guide Book';
export const INTL_ITEM_HS_CODE = '9609100919';

// Confirmed real registered business address (Get Accounts, production
// account 0005303796) -- used as the "from" for every AusPost address
// validation, pricing check, and shipment creation.
export const SENDER_ADDRESS = {
  // Real, confirmed registered business name and street address from
  // tonight's actual production Get Accounts response for account
  // 0005303796. Both were missing entirely before -- Get Shipment
  // Price didn't need them (pricing doesn't care who's sending or
  // their exact street address), but Create Shipment requires both,
  // which is why shipment creation kept failing one missing-field
  // error at a time while pricing worked fine using this same object.
  name: 'Rocket Logistics Australia Pty Ltd',
  lines: ['26-28 Scammel St'],
  suburb: 'CAMPBELLFIELD',
  state: 'VIC',
  postcode: '3061',
  // Real confirmed email from tonight's Get Accounts response. Phone
  // is a placeholder (no real one was ever returned by Get Accounts to
  // confirm) -- worth replacing with the business's actual number if
  // AusPost ever rejects this specific value.
  email: 'ops@seaga.com.au',
  phone: '0400000000',
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

// AusPost's real, confirmed field limits (from the Create Shipment /
// Get Shipment Price field reference): name and business_name are each
// capped at 40 characters; the first address line is capped at 40, the
// second address line explicitly documented as accepting up to 60.
// Third line assumed to follow the second line's limit, since AusPost's
// docs describe lines 2/3 as a matching pair distinct from line 1.
export const AUSPOST_NAME_MAX = 40;
export const AUSPOST_ADDRESS_LINE1_MAX = 40;
export const AUSPOST_ADDRESS_LINE_OTHER_MAX = 60;

// Hard truncation for name/business_name fields -- AusPost has no
// concept of "continue on another field" for these the way it does for
// addresses, so this is a plain cut to the limit.
export function truncateField(value, maxLen = AUSPOST_NAME_MAX) {
  const s = (value || '').toString().trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

// Splits a full address string into up to 3 AusPost address lines,
// respecting each line's real character limit. Breaks on word
// boundaries (spaces) so a word is never cut in half across lines --
// only falls back to a hard mid-word cut if a single word alone still
// exceeds a line's limit, which real address data essentially never
// hits. Any overflow beyond what 3 lines can hold is dropped, since
// AusPost's own address type caps out at three lines.
export function buildAddressLines(fullAddress) {
  const words = (fullAddress || '').toString().trim().split(/\s+/).filter(Boolean);
  const limits = [AUSPOST_ADDRESS_LINE1_MAX, AUSPOST_ADDRESS_LINE_OTHER_MAX, AUSPOST_ADDRESS_LINE_OTHER_MAX];
  const lines = [];
  let current = '';
  let lineIndex = 0;

  for (const word of words) {
    if (lineIndex >= 3) break; // out of lines -- real overflow, dropped

    const limit = limits[lineIndex];
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    // Doesn't fit on the current line -- close it out and start the
    // next one, unless this single word alone is longer than an entire
    // line's limit (rare), in which case hard-cut it rather than push
    // it whole onto a line it can never fit.
    if (current) {
      lines.push(current);
      lineIndex += 1;
      current = '';
    }
    if (lineIndex >= 3) break;

    if (word.length > limits[lineIndex]) {
      lines.push(word.slice(0, limits[lineIndex]));
      lineIndex += 1;
      current = '';
    } else {
      current = word;
    }
  }
  if (current && lineIndex < 3) lines.push(current);

  return lines.filter(Boolean);
}