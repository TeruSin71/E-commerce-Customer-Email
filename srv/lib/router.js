// Table-driven carrier routing (doc 08 §5): route(werks, destCountry, bukrs) →
// { providerId, destinationName, accountRef, serviceMeta }. No hardcoded carrier selection.
// Contract lookup is FAIL-CLOSED: no active contract row → error. NEVER fall back to
// no-contract (would silently quote list rates instead of contract rates).
const cds = require('@sap/cds')

const TTL_MS = 5 * 60 * 1000
const contractCache = new Map() // key -> { accountRef, currency, expires }

async function route(werks, destCountry, bukrs) {
  const { SELECT } = cds.ql
  const { Routes, Carriers } = cds.entities('courier')

  const candidates = await cds.run(
    SELECT.from(Routes)
      .where({ werks, dest_country: { in: [destCountry, 'DOM'] }, active: true })
      .orderBy('priority')
  )
  if (!candidates.length) {
    throw Object.assign(new Error(`no active route for plant ${werks} → ${destCountry}`), { status: 422 })
  }
  const picked = candidates[0]

  const [carrier] = await cds.run(
    SELECT.from(Carriers).where({ carrier_id: picked.carrier_id, active: true })
  )
  if (!carrier) {
    throw Object.assign(new Error(`route points at inactive/unknown carrier ${picked.carrier_id}`), { status: 422 })
  }

  const contract = await contractFor(picked.carrier_id, bukrs)
  return {
    providerId: carrier.carrier_id,
    destinationName: carrier.destination_name, // name only — URL+credential live in the destination service (S1)
    accountRef: contract.accountRef,
    currency: contract.currency,
    labelFormat: carrier.label_format,
  }
}

// fail-closed contract cache over CarrierAccounts (synced from ECC ZI_CarrierContract later)
async function contractFor(carrierId, bukrs) {
  const key = `${carrierId}/${bukrs}`
  const hit = contractCache.get(key)
  if (hit && hit.expires > Date.now()) return hit
  const { SELECT } = cds.ql
  const { CarrierAccounts } = cds.entities('courier')
  const today = new Date().toISOString().slice(0, 10)
  const rows = await cds.run(
    SELECT.from(CarrierAccounts)
      .where({ carrier_id: carrierId, bukrs, active: true, valid_from: { '<=': today } })
      .orderBy({ valid_from: 'desc' })
  )
  const current = rows.find((r) => !r.valid_to || r.valid_to >= today)
  if (!current) {
    // FAIL the rate/book call — never quote without the negotiated contract (doc 08 §4.1)
    throw Object.assign(new Error(`no active carrier contract for ${carrierId}/${bukrs}`), { status: 422 })
  }
  const entry = { accountRef: current.account_ref, currency: current.currency, expires: Date.now() + TTL_MS }
  contractCache.set(key, entry)
  return entry
}

module.exports = { route, _contractCache: contractCache }
