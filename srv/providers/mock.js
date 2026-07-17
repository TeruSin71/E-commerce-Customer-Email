// SYNTHETIC carrier provider — DEV/TEST ONLY (never registered in production, see index.js).
// Implements the CourierProvider interface (doc 08 §5) with deterministic fake responses so
// tasks 1.7–1.11 can build and test against the real interface until providers/nzpost lands
// (gated on Open Item #2 + NZ Post sandbox, 0.4). Delete-or-keep decision at 1.6b: keep —
// a deterministic provider stays useful for tests even after real carriers exist.

const RATE_PER_KG = 2.5
const BASE_PRICE = 5.0

module.exports = {
  id: 'MOCK',

  async rate(req) {
    const totalKg = req.hus.reduce((kg, hu) => kg + hu.weightKg, 0)
    return [
      {
        rateId: `MOCK-STD-${req.vbeln}`,
        providerId: 'MOCK',
        service: 'MOCK-STD',
        price: Number((BASE_PRICE + RATE_PER_KG * totalKg).toFixed(2)),
        currency: req.currency || 'NZD',
        etaDays: 2,
      },
    ]
  },

  async book(req) {
    return req.hus.map((hu, i) => ({
      exidv: hu.exidv,
      tracking: `MOCK${req.vbeln}${String(i).padStart(2, '0')}`,
      carrierShipmentId: `MOCKSHIP-${req.vbeln}`,
      labelBytes: Buffer.from(`^XA^FDMOCK LABEL ${req.vbeln}/${hu.exidv}^FS^XZ`),
      format: 'ZPL',
      isPrimary: i === 0,
    }))
  },

  async void() {},

  verifyWebhook() {
    return false // mock accepts NO webhooks — fail closed
  },

  normalizeEvent() {
    return { eventType: 'unknown' } // fail closed (S6)
  },
}
