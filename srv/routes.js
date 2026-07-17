// courier-srv REST routes (doc 08 §3). Every route sits behind the app-wide auth middleware
// (validate → plants) plus its per-route scope gate. Plant filtering uses req.plants ONLY.
const { requireScope } = require('./middleware/auth')
const ecc = require('./lib/ecc')

module.exports = function routes(app) {
  // 1.5 — worklist proxy: packed, not-yet-shipped deliveries for the user's plants
  app.get('/deliveries', requireScope('view'), async (req, res, next) => {
    try {
      res.json(await ecc.deliveries(req.plants))
    } catch (e) {
      next(e)
    }
  })
}
