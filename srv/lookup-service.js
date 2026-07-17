// LookupService guards (S3/H3 on the OData path). The express xssec middleware
// (srv/middleware/auth.js) already runs ahead of every CAP-mounted route, so an
// unvalidated token never reaches here (401 there, S7) — pinned by the no-token 401
// test in test/lookup-odata.test.js. This handler adds the two checks the middleware
// leaves per-route: the `view` scope and the plant filter. The plant-list rule itself
// is NOT re-implemented here — assertPlants is the repository's own guard (docs/09 §3),
// so the REST and OData surfaces can never drift apart on what a valid plants list is.
const { assertPlants } = require('./lib/repository')

module.exports = (srv) => {
  // registered on Shipments BY NAME, not '*': the werks column is Shipments-specific.
  // A future werks-less projection (e.g. ShipmentEvents) must bring its own join-scoped
  // guard — a wildcard here would silently mis-scope it.
  srv.before('READ', 'Shipments', (req) => {
    const httpReq = req.http?.req
    const authInfo = httpReq?.authInfo
    if (!authInfo || !authInfo.checkLocalScope('view')) return req.reject(403)
    try {
      assertPlants(httpReq.plants) // fail closed: same rule as every REST read
    } catch {
      return req.reject(403)
    }
    // injected into every READ (list, by-key, $count, inside $batch) — ANDed with any client $filter
    req.query.where({ werks: { in: httpReq.plants } })
  })
}
