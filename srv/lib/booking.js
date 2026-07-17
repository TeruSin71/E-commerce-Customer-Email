// The money path (doc 08 §6, S4/M1). Exact order: idempotency-replay check → per-DO claim →
// existing rows returned as-is → carrier book → label bytes → persist rows → THEN respond.
// Never check-then-write as the guard: the DB unique (vbeln, exidv) index is the backstop.
const cds = require('@sap/cds')
const { route } = require('./router')
const { providerFor } = require('../providers')
const ecc = require('./ecc')
const LOG = cds.log('booking')

// ponytail: in-process per-DO mutex gives the "exactly ONE carrier call" guarantee — the app
// runs as a single CF instance by design (doc 08 §2, mta instances: 1). If instances ever
// scale, the DB unique index still prevents double rows; upgrade path = DB advisory lock.
const locks = new Map()
async function withLock(key, fn) {
  while (locks.has(key)) await locks.get(key)
  let release
  const gate = new Promise((resolve) => (release = resolve))
  locks.set(key, gate)
  try {
    return await fn()
  } finally {
    locks.delete(key)
    release()
  }
}

const toResponse = (rows) =>
  [...rows]
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((r) => ({ exidv: r.exidv, tracking: r.tracking_number, zplRef: `/label/${r.ID}` }))

async function book({ dlv, rateId, idempotencyKey, user }) {
  const { SELECT, INSERT } = cds.ql
  const { Shipments, BookingIdempotency } = cds.entities('courier')

  // retried request with the same key → first result, no second carrier call (doc 08 §6.2)
  if (idempotencyKey) {
    const [hit] = await cds.run(SELECT.from(BookingIdempotency).where({ idempotency_key: idempotencyKey }))
    if (hit) return JSON.parse(hit.response)
  }

  return withLock(dlv.vbeln, async () => {
    const existing = await cds.run(SELECT.from(Shipments).where({ vbeln: dlv.vbeln }))
    if (existing.length) return toResponse(existing) // second request receives the FIRST booking

    const from = await ecc.plantAddress(dlv.werks)
    const routed = await route(dlv.werks, dlv.country, from.bukrs)
    const provider = providerFor(routed.providerId)
    const shipReq = {
      vbeln: dlv.vbeln,
      hus: dlv.hus,
      from,
      to: { street: dlv.street, city: dlv.city, postcode: dlv.postcode, region: dlv.region, country: dlv.country },
      accountRef: routed.accountRef,
      currency: routed.currency,
    }
    const options = await provider.rate(shipReq)
    const opt = options.find((o) => o.rateId === rateId)
    if (!opt) throw Object.assign(new Error('rateId not found for this delivery — re-rate first'), { status: 422 })

    // carrier book → label bytes arrive with the booking → persist → respond (doc 08 §6.3)
    const bookings = await provider.book({ ...shipReq, service: opt.service })
    const now = new Date().toISOString()
    const rows = bookings.map((b) => ({
      ID: cds.utils.uuid(),
      vbeln: dlv.vbeln,
      exidv: b.exidv,
      werks: dlv.werks,
      bukrs: from.bukrs,
      so_number: dlv.soNumber,
      carrier_id: routed.providerId,
      service_code: opt.service,
      tracking_number: b.tracking,
      carrier_shipment_id: b.carrierShipmentId,
      is_primary: b.isPrimary,
      rate_quoted: opt.price,
      currency: opt.currency,
      label_bytes: b.labelBytes, // OUR copy — never the carrier URL (S2)
      label_format: b.format,
      status: 'booked',
      ship_to_name: dlv.shipToName,
      ship_to_email: dlv.email,
      ship_to_country: dlv.country,
      booked_at: now,
      created_by: user,
    }))
    try {
      await cds.run(INSERT.into(Shipments).entries(rows))
    } catch (e) {
      const again = await cds.run(SELECT.from(Shipments).where({ vbeln: dlv.vbeln }))
      if (again.length) return toResponse(again) // unique-index race (cross-instance backstop)
      // booked at the carrier but not persisted — manual void needed (doc 08 §6.3). No PII in log.
      LOG.error('CRITICAL: carrier booking not persisted — manual void required', {
        vbeln: dlv.vbeln,
        carrier_id: routed.providerId,
        carrier_shipment_id: bookings[0] && bookings[0].carrierShipmentId,
      })
      throw e
    }

    const response = toResponse(rows)
    if (idempotencyKey) {
      await cds
        .run(INSERT.into(BookingIdempotency).entries({ idempotency_key: idempotencyKey, vbeln: dlv.vbeln, response: JSON.stringify(response), created_at: now }))
        .catch(() => {}) // same-key race: the first stored response wins; replay reads that one
    }
    return response
  })
}

module.exports = { book }
