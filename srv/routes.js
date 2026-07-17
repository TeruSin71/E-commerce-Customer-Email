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
}
