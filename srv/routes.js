// courier-srv REST routes (doc 08 §3). Every route sits behind the app-wide auth middleware
// (validate → plants) plus its per-route scope gate. Plant filtering uses req.plants ONLY.
// JSON body parsing is PER-ROUTE — /webhook/:carrier (1.12) needs the raw body for HMAC.
const cds = require('@sap/cds')
const express = require('express')
const { requireScope } = require('./middleware/auth')
const ecc = require('./lib/ecc')
const { route } = require('./lib/router')
const { providerFor } = require('./providers')
const booking = require('./lib/booking')
const forPlants = require('./lib/repository')
const audit = require('./lib/audit')

const json = express.json({ limit: '100kb' })

// one delivery, ONLY if visible to the caller's plants — unknown and other-plant look identical (404)
async function visibleDelivery(vbeln, plants) {
  const rows = await ecc.deliveries(plants)
  const dlv = rows.find((d) => d.vbeln === vbeln)
  if (!dlv) throw Object.assign(new Error('delivery not found'), { status: 404 })
  return dlv
}

module.exports = function routes(app) {
  // 1.5 — worklist proxy: packed, not-yet-shipped deliveries for the user's plants
  app.get('/deliveries', requireScope('view'), async (req, res, next) => {
    try {
      res.json(await ecc.deliveries(req.plants))
    } catch (e) {
      next(e)
    }
  })

  // 1.7 — rate options for one delivery. Read-only, no side effects (doc 08 §3).
  app.post('/rates', requireScope('rate'), json, async (req, res, next) => {
    try {
      const { vbeln } = req.body || {}
      if (!vbeln) return res.status(400).json({ error: 'vbeln required' })
      const dlv = await visibleDelivery(vbeln, req.plants)
      const from = await ecc.plantAddress(dlv.werks)
      const routed = await route(dlv.werks, dlv.country, from.bukrs)
      const options = await providerFor(routed.providerId).rate({
        vbeln: dlv.vbeln,
        hus: dlv.hus,
        from,
        to: { street: dlv.street, city: dlv.city, postcode: dlv.postcode, region: dlv.region, country: dlv.country },
        accountRef: routed.accountRef,
        currency: routed.currency,
      })
      res.json(options)
    } catch (e) {
      next(e)
    }
  })

  // 1.8 — book: idempotent money path (doc 08 §6, S4). Returns [{exidv, tracking, zplRef}].
  app.post('/book', requireScope('book'), json, async (req, res, next) => {
    try {
      const { vbeln, rateId, idempotencyKey } = req.body || {}
      if (!vbeln || !rateId) return res.status(400).json({ error: 'vbeln and rateId required' })
      const dlv = await visibleDelivery(vbeln, req.plants)
      const user = req.authInfo.token.payload.user_name || req.authInfo.token.payload.client_id
      res.json(await booking.book({ dlv, rateId, idempotencyKey, user }))
    } catch (e) {
      next(e)
    }
  })

  // 1.9 — label download: stored bytes ONLY, authenticated + plant-checked (S2/H2).
  // NEVER a redirect to a carrier URL. reprint scope — labels are PII (name + address).
  app.get('/label/:id', requireScope('reprint'), async (req, res, next) => {
    try {
      const [row] = await cds.run(forPlants(req.plants).labelById(req.params.id))
      if (!row || !row.label_bytes) return res.status(404).json({ error: 'label not found' })
      res.type('application/octet-stream')
      row.label_bytes.on('error', next).pipe(res) // stream stored bytes; no carrier URL, ever (S2/H2)
    } catch (e) {
      next(e)
    }
  })

  // 1.9 — reprint: stored ZPL for a delivery's shipments, plant-checked (S3 label leg).
  app.post('/reprint', requireScope('reprint'), json, async (req, res, next) => {
    try {
      const { vbeln } = req.body || {}
      if (!vbeln) return res.status(400).json({ error: 'vbeln required' })
      const rows = await cds.run(forPlants(req.plants).byVbeln(vbeln))
      if (!rows.length) return res.status(404).json({ error: 'no shipments for delivery' })
      res.json(rows.map((r) => ({ exidv: r.exidv, tracking: r.tracking_number, zplRef: `/label/${r.ID}`, format: r.label_format })))
    } catch (e) {
      next(e)
    }
  })

  // 1.10 — shipment lookup by vbeln / tracking / SO. Plant-filtered ALWAYS (S3/H3).
  app.get('/shipments', requireScope('view'), async (req, res, next) => {
    try {
      const repo = forPlants(req.plants)
      const { vbeln, tracking, so } = req.query
      const q = vbeln ? repo.byVbeln(vbeln) : tracking ? repo.byTracking(tracking) : so ? repo.bySo(so) : null
      if (!q) return res.status(400).json({ error: 'one of vbeln, tracking, so required' })
      res.json((await cds.run(q)).map(publicShipment))
    } catch (e) {
      next(e)
    }
  })

  // 1.10 — dashboard: counts by state for the caller's plants (S3/H3). Plant-filtered.
  app.get('/dashboard', requireScope('view'), async (req, res, next) => {
    try {
      const { SELECT } = cds.ql
      const { Shipments } = cds.entities('courier')
      const rows = await cds.run(
        SELECT.from(Shipments).columns('werks', 'status', 'count(*) as n').where({ werks: { in: req.plants } }).groupBy('werks', 'status')
      )
      res.json(rows.map((r) => ({ werks: r.werks, status: r.status, count: Number(r.n) })))
    } catch (e) {
      next(e)
    }
  })

  // 1.11 — void: carrier void/refund + mark row voided + immutable audit row (S8, M3).
  // Same scope+plant guard as book. Body: {vbeln, exidv?} (exidv narrows to one HU).
  app.post('/void', requireScope('void'), json, async (req, res, next) => {
    try {
      const { vbeln, exidv } = req.body || {}
      if (!vbeln) return res.status(400).json({ error: 'vbeln required' })
      const all = await cds.run(forPlants(req.plants).byVbeln(vbeln))
      const targets = exidv ? all.filter((r) => r.exidv === exidv) : all
      const live = targets.filter((r) => r.status !== 'voided')
      if (!live.length) return res.status(404).json({ error: 'no voidable shipment for delivery' })

      const actor = req.authInfo.token.payload.user_name || req.authInfo.token.payload.client_id
      const { UPDATE } = cds.ql
      const { Shipments } = cds.entities('courier')
      const voided = []
      for (const row of live) {
        const from = await ecc.plantAddress(row.werks)
        const routed = await route(row.werks, row.ship_to_country, from.bukrs)
        await providerFor(routed.providerId).void({ vbeln: row.vbeln, exidv: row.exidv, carrierShipmentId: row.carrier_shipment_id })
        await cds.run(UPDATE(Shipments).set({ status: 'voided' }).where({ ID: row.ID }))
        await audit.record({ actor, action: 'void', object: `${row.vbeln}/${row.exidv}`, before: { status: row.status }, after: { status: 'voided' } })
        voided.push({ exidv: row.exidv, tracking: row.tracking_number, status: 'voided' })
      }
      res.json(voided)
    } catch (e) {
      next(e)
    }
  })
}

// projection for read APIs — never ships label bytes; PII limited to what the lookup needs
function publicShipment(r) {
  return {
    id: r.ID,
    vbeln: r.vbeln,
    exidv: r.exidv,
    soNumber: r.so_number,
    werks: r.werks,
    carrierId: r.carrier_id,
    trackingNumber: r.tracking_number,
    status: r.status,
    isPrimary: r.is_primary,
    shipToName: r.ship_to_name,
    shipToCountry: r.ship_to_country,
    bookedAt: r.booked_at,
    zplRef: `/label/${r.ID}`,
  }
}
