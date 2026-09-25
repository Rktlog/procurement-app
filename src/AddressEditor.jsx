import { useId, useState } from 'react';

const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

// Full shipping-address editor for a queued order, used on the Validate &
// price step. The AusPost check only verifies suburb + state + postcode, so
// when a customer has typed the wrong street, unit or recipient, this is
// where it gets fixed before the label is made.
//
// Edits change the order in this shipping batch (and so the label only),
// never the sale in Cin7 or the order in Shopify.
//
// `format` picks which field names the order uses:
//   'cin7'    -> Pantone / DEAR sales (ShippingAddress.Line1, City, State, Postcode)
//   'shopify' -> Shopify orders (rawAddress.address1, city, provinceCode, zip)
const FORMATS = {
  cin7: {
    countryLabel: 'Country',
    toDraft: (order) => {
      const a = order.ShippingAddress || order.rawAddress || {};
      return {
        name: order.Customer || order.customer || '',
        phone: order.Phone || order.phone || '',
        company: a.Company || '',
        line1: a.Line1 || '',
        line2: a.Line2 || '',
        line3: a.Line3 || '',
        suburb: a.City || '',
        state: a.State || '',
        postcode: a.Postcode || '',
        country: a.Country || '',
      };
    },
    fromDraft: (order, d, isInternational) => {
      const a = order.ShippingAddress || order.rawAddress || {};
      return {
        ...order,
        Customer: d.name,
        Phone: d.phone,
        ShippingAddress: {
          ...a,
          Company: d.company,
          Line1: d.line1,
          Line2: d.line2,
          Line3: d.line3,
          City: d.suburb,
          State: d.state,
          Postcode: d.postcode,
          Country: isInternational ? d.country : a.Country,
        },
      };
    },
  },
  shopify: {
    countryLabel: 'Country code (e.g. NZ, US)',
    toDraft: (order) => {
      const a = order.rawAddress || {};
      return {
        name: order.customer || a.name || '',
        phone: order.phone || a.phone || '',
        company: a.company || '',
        line1: a.address1 || '',
        line2: a.address2 || '',
        line3: '',
        suburb: a.city || '',
        state: a.provinceCode || '',
        postcode: a.zip || '',
        country: a.countryCodeV2 || '',
      };
    },
    fromDraft: (order, d, isInternational) => {
      const a = order.rawAddress || {};
      return {
        ...order,
        customer: d.name,
        phone: d.phone,
        rawAddress: {
          ...a,
          name: d.name,
          phone: d.phone,
          company: d.company,
          address1: d.line1,
          address2: d.line2,
          city: d.suburb,
          provinceCode: d.state,
          zip: d.postcode,
          countryCodeV2: isInternational ? d.country.toUpperCase() : a.countryCodeV2,
        },
      };
    },
  },
};

export default function AddressEditor({ order, format = 'cin7', isInternational, suburbSuggestions = [], onSave, onCancel }) {
  const adapter = FORMATS[format];
  const uid = useId();

  const [draft, setDraft] = useState(() => adapter.toDraft(order));
  const [showLine3] = useState(() => Boolean(adapter.toDraft(order).line3));

  const set = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.value }));

  const stateUpper = draft.state.trim().toUpperCase();
  const errors = {
    name: !draft.name.trim() && 'Enter who the parcel is for.',
    line1: !draft.line1.trim() && 'Enter the street address.',
    suburb: !draft.suburb.trim() && 'Enter the suburb.',
    state: !isInternational && !AU_STATES.includes(stateUpper) && 'Pick a state.',
    postcode: !isInternational && !/^\d{4}$/.test(draft.postcode.trim()) && 'Australian postcodes are 4 digits.',
    country: isInternational && !draft.country.trim() && 'Enter the country.',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const [triedSave, setTriedSave] = useState(false);

  const handleSave = () => {
    setTriedSave(true);
    if (hasErrors) return;
    const trimmed = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]));
    if (!isInternational) trimmed.state = stateUpper;
    onSave(adapter.fromDraft(order, trimmed, isInternational));
  };

  const field = (key, label, props = {}, wide = false) => (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="block text-[0.78rem] font-semibold text-slate-700 mb-1">{label}</span>
      <input
        value={draft[key]}
        onChange={set(key)}
        className={`w-full h-9 rounded-md border bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/25 ${
          triedSave && errors[key] ? 'border-red-400' : 'border-slate-300 focus:border-blue-600'
        }`}
        {...props}
      />
      {triedSave && errors[key] && <span className="block mt-1 text-[0.75rem] text-red-700">{errors[key]}</span>}
    </label>
  );

  return (
    <div className="rounded-lg border border-blue-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h4 className="text-sm font-bold text-ink">Edit shipping address</h4>
        <span className="text-[0.78rem] text-slate-500">
          Changes apply to this label only, not the {format === 'shopify' ? 'order in Shopify' : 'sale in Cin7'}.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field('name', 'Recipient name', { autoFocus: true })}
        {field('company', 'Company (optional)')}
        {field('phone', 'Phone', { type: 'tel' })}
        <div className="hidden lg:block" />

        {field('line1', 'Street address', {}, true)}
        {field('line2', 'Unit, level or building (optional)', {}, true)}
        {showLine3 && field('line3', 'Address line 3', {}, true)}

        {field('suburb', 'Suburb', { list: suburbSuggestions.length ? `${uid}-suburbs` : undefined, autoComplete: 'off' })}
        {suburbSuggestions.length > 0 && (
          <datalist id={`${uid}-suburbs`}>
            {suburbSuggestions.slice(0, 20).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}

        {isInternational ? (
          field('state', 'State / region')
        ) : (
          <label className="block">
            <span className="block text-[0.78rem] font-semibold text-slate-700 mb-1">State</span>
            <select
              value={stateUpper}
              onChange={set('state')}
              className={`w-full h-9 rounded-md border bg-white px-2 text-sm ${
                triedSave && errors.state ? 'border-red-400' : 'border-slate-300'
              }`}
            >
              <option value="">Select</option>
              {AU_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {triedSave && errors.state && <span className="block mt-1 text-[0.75rem] text-red-700">{errors.state}</span>}
          </label>
        )}

        {field('postcode', 'Postcode', isInternational ? {} : { inputMode: 'numeric', maxLength: 4 })}
        {isInternational && field('country', adapter.countryLabel)}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="h-9 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
        >
          Save and re-check
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-4 rounded-md border border-slate-300 bg-white text-sm font-semibold text-ink hover:bg-slate-50 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
