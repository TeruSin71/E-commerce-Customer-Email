// ECC read access — the ONE module that talks to the ECC CDS views (doc 08 §4).
// Until the real OData destination is bound (task 1.2 + Cloud Connector), a synthetic
// fixture stands in — DEV/TEST ONLY. In production, missing ECC config fails closed:
// no destination → 503, never mock data. Remove the fixture when ECC is live
// (task-log: every task verified on synthetic carries a re-verify-on-real-ECC tag).
const cds = require('@sap/cds')
const LOG = cds.log('ecc')

// Synthetic ZC_CourierDelivery rows — field shape EXACTLY per doc 08 §4.1.
// Two plants so plant-scope tests can prove filtering; multi-HU case included (10% reality).
const SYNTHETIC_DELIVERIES = [
  {
    vbeln: '0080000101',
    werks: '1000',
    soNumber: '0010000101',
    shipToName: 'Aroha Ngata',
    street: '12 Karangahape Rd',
    city: 'Auckland',
    postcode: '1010',
    region: 'AUK',
    country: 'NZ',
    email: 'aroha.ngata@example.com',
    incoterms: 'DAP',
    hus: [{ exidv: 'HU00000101', weightKg: 2.4, lengthCm: 30, widthCm: 20, heightCm: 15 }],
  },
  {
    vbeln: '0080000102',
    werks: '1000',
    soNumber: '0010000102',
    shipToName: 'Ben Cooper',
    street: '5 Willis St',
    city: 'Wellington',
    postcode: '6011',
    region: 'WGN',
    country: 'NZ',
    email: 'ben.cooper@example.com',
    incoterms: 'DAP',
    hus: [
      { exidv: 'HU00000102', weightKg: 8.1, lengthCm: 60, widthCm: 40, heightCm: 30 },
      { exidv: 'HU00000103', weightKg: 1.2, lengthCm: 25, widthCm: 18, heightCm: 10 },
    ],
  },
  {
    vbeln: '0080000201',
    werks: '2000',
    soNumber: '0010000201',
    shipToName: 'Grace Chen',
    street: '88 Collins St',
    city: 'Melbourne',
    postcode: '3000',
    region: 'VIC',
    country: 'AU',
    email: 'grace.chen@example.com',
    incoterms: 'DAP',
    hus: [{ exidv: 'HU00000201', weightKg: 4.0, lengthCm: 40, widthCm: 30, heightCm: 20 }],
  },
]

function eccConfigured() {
  return Boolean(cds.env.requires?.ecc?.credentials || process.env.ECC_DESTINATION)
}

// Packed-not-shipped worklist (KOSTK='C' AND PKSTK='C' AND WBSTK≠'C' is applied inside the
// ECC view itself). plants comes from the JWT ONLY (set by auth middleware) — applied here
// as the server-side filter, exactly like the real OData call will ($filter=werks in ...).
async function deliveries(plants) {
  if (!Array.isArray(plants) || plants.length === 0) return []
  if (eccConfigured()) {
    // Task 1.2 wires the real OData call via the ECC destination here.
    throw Object.assign(new Error('real ECC client not implemented yet (task 1.2)'), { status: 503 })
  }
  if (process.env.NODE_ENV === 'production') {
    // fail closed: production must never serve synthetic data
    throw Object.assign(new Error('ECC destination not configured'), { status: 503 })
  }
  LOG.warn('serving SYNTHETIC deliveries — dev/test only, remove when ECC is bound')
  return SYNTHETIC_DELIVERIES.filter((d) => plants.includes(d.werks))
}

module.exports = { deliveries }
