// SYNTHETIC carrier provider — DEV/TEST ONLY (never registered in production, see index.js).
// Implements the CourierProvider interface (doc 08 §5) with deterministic fake responses so
// tasks 1.7–1.12 can build and test against the real interface until providers/nzpost lands
// (gated on Open Item #2 + NZ Post sandbox, 0.4). Delete-or-keep decision at 1.6b: keep —
// a deterministic provider stays useful for tests even after real carriers exist.
const crypto = require('node:crypto')
const { timingSafeEqualHex, freshTimestamp } = require('../lib/sig')

const RATE_PER_KG = 2.5
const BASE_PRICE = 5.0

// carrier vocab → canonical enum (doc 08 §5). Real carriers keep this in carriers.status_map;
// the mock hardcodes a small map so S6's fail-closed 'unknown' path is testable.
const STATUS_MAP = {
  ACCEPTED: 'pre_transit',
  PICKED_UP: 'in_transit',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
  RETURNED: 'returned',
}

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

  // HMAC-SHA256 over `${timestamp}.${rawBody}`, constant-time compare + ±5min window (S5).
  verifyWebhook(headers, rawBody, secret) {
    const ts = headers['x-mock-timestamp']
    const sig = headers['x-mock-signature']
    if (!ts || !sig || !freshTimestamp(ts)) return false
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody.toString('utf8')}`).digest('hex')
    return timingSafeEqualHex(sig, expected)
  },

  // carrier word → canonical enum; unmapped → 'unknown' (fail closed, S6)
  normalizeEvent(payload) {
    const raw = String(payload.status ?? '')
    return {
      tracking: payload.tracking,
      eventTypeRaw: raw,
      eventType: STATUS_MAP[raw.toUpperCase()] || 'unknown',
      eventTs: payload.timestamp || new Date().toISOString(),
      payload,
    }
  },
}
