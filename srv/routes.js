// courier-srv REST routes (doc 08 §3). Every route sits behind the app-wide auth middleware
// (validate → plants) plus its per-route scope gate. Plant filtering uses req.plants ONLY.
// JSON body parsing is PER-ROUTE — /webhook/:carrier (1.12) needs the raw body for HMAC.
const express = require('express')
const { requireScope } = require('./middleware/auth')
const ecc = require('./lib/ecc')
const { route } = require('./lib/router')
const { providerFor } = require('./providers')

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
}
