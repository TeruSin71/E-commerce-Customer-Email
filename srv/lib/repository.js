// The ONLY query path to parcel data (security H3, docs/09 §3). Every accessor injects
// `werks in plants` — there is deliberately no variant without it, and the plants list is
// required up front (fail closed). plants = req.plants, set by the auth middleware from the JWT.
const cds = require('@sap/cds')

// THE plant-list guard — the single definition of "valid plants from the JWT" (fail closed).
// Exported so every OTHER read surface (the OData LookupService) applies the IDENTICAL rule;
// two hand-maintained copies of this check is how cross-plant leaks are born.
function assertPlants(plants) {
  if (!Array.isArray(plants) || plants.length === 0 || plants.some((p) => typeof p !== 'string' || !p)) {
    throw new Error('repository requires the allowed-plants list from the JWT werks attribute')
  }
}

module.exports = function forPlants(plants) {
  assertPlants(plants)
  const { SELECT } = cds.ql
  const { Shipments } = cds.entities('courier')
  return {
    byId: (id) => SELECT.from(Shipments).where({ ID: id, werks: { in: plants } }),
    // label_bytes is LargeBinary (media): excluded from SELECT *, so request it explicitly.
    // CAP returns it as a Readable stream — the route pipes it (never buffers PII in memory).
    labelById: (id) => SELECT.columns('ID', 'label_bytes', 'label_format').from(Shipments).where({ ID: id, werks: { in: plants } }),
    byVbeln: (v) => SELECT.from(Shipments).where({ vbeln: v, werks: { in: plants } }),
    byTracking: (t) => SELECT.from(Shipments).where({ tracking_number: t, werks: { in: plants } }),
    bySo: (so) => SELECT.from(Shipments).where({ so_number: so, werks: { in: plants } }),
    // every accessor added by later tasks injects `werks: { in: plants }` the same way
  }
}

module.exports.assertPlants = assertPlants
