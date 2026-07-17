// Public webhook receiver (doc 08 §7, S5/S6). The ONE untrusted-input route. Order is exact:
// rate-limit → body cap → HMAC+timestamp verify → dedupe insert → 200 fast → async worker.
// The event is durably stored (ShipmentEvents, processed=false) BEFORE the 200, so the async
// worker is best-effort: anything it drops (over the in-flight cap, or a crash) is caught by
// the nightly poller (task 1.14). That is why "bounded queue" here is just an in-flight counter,
// not a queue system — the durability lives in the DB, not in memory.
const cds = require('@sap/cds')
const { providerFor } = require('../providers')
const email = require('./email')
const LOG = cds.log('webhook')

const RATE_MAX = 120 // requests per source per window
const RATE_WINDOW_MS = 60_000
const MAX_INFLIGHT = 50 // async worker backpressure; overflow rides the nightly poller

// ── fixed-window rate limiter, per source. ponytail: single CF instance by design; if the app
//    ever scales out, move this to a shared store (Redis) — the DB dedupe already guards correctness. ──
const hits = new Map()
function rateLimited(source, now = Date.now()) {
  const e = hits.get(source)
  if (!e || now - e.start >= RATE_WINDOW_MS) {
    hits.set(source, { start: now, n: 1 })
    return false
  }
  e.n += 1
  return e.n > RATE_MAX
}

// webhook secret lives in the carrier's destination (S1). Until that binding lands (1.6b),
// a per-carrier env var stands in. ponytail: env placeholder → destination lookup at 1.6b.
function webhookSecret(carrierId) {
  return process.env[`WEBHOOK_SECRET_${carrierId.toUpperCase()}`]
}

let inflight = 0

async function handle(req, res) {
  const carrierId = String(req.params.carrier || '').toUpperCase()
  const source = req.ip || req.socket?.remoteAddress || 'unknown'

  if (rateLimited(`${carrierId}:${source}`)) return res.sendStatus(429)

  let provider
  try {
    provider = providerFor(carrierId)
  } catch {
    return res.sendStatus(404) // unknown carrier — never process
  }
  const secret = webhookSecret(carrierId)
  const raw = req.body // Buffer, from express.raw (cap enforced upstream → 413)

  // HMAC + signed-timestamp verification is carrier-specific; fail closed on any error (S5)
  let ok
  try {
    ok = secret ? provider.verifyWebhook(req.headers, raw, secret) : false
  } catch {
    ok = false
  }
  if (!ok) return res.sendStatus(401)

  // normalize + dedupe-insert the raw event (S6: unmapped status → 'unknown', fail closed)
  let event
  try {
    event = provider.normalizeEvent(JSON.parse(raw.toString('utf8')))
  } catch {
    return res.sendStatus(400)
  }
  if (!validShape(event)) return res.sendStatus(400)

  const inserted = await insertEvent(carrierId, event)
  res.sendStatus(200) // fast 200 — no heavy work inline (doc 08 §7.6)

  if (inserted && inflight < MAX_INFLIGHT) {
    inflight += 1
    setImmediate(() =>
      processEvent(inserted).catch((e) => LOG.error('event worker failed', { id: inserted.ID, err: e.message })).finally(() => (inflight -= 1))
    )
  }
}

// carrier response strings are UNTRUSTED (S11): bound shape/length before store
function validShape(e) {
  return (
    e &&
    typeof e.tracking === 'string' && e.tracking.length > 0 && e.tracking.length <= 60 &&
    typeof e.eventTypeRaw === 'string' && e.eventTypeRaw.length <= 60 &&
    typeof e.eventType === 'string' && e.eventType.length <= 40 &&
    e.eventTs
  )
}

async function insertEvent(carrierId, e) {
  const { INSERT } = cds.ql
  const { ShipmentEvents } = cds.entities('courier')
  const row = {
    ID: cds.utils.uuid(),
    carrier_id: carrierId,
    tracking_number: e.tracking,
    event_type_raw: e.eventTypeRaw,
    event_type: e.eventType, // 'unknown' if the carrier's word isn't mapped (S6)
    event_ts: new Date(e.eventTs).toISOString(),
    payload: JSON.stringify(e.payload ?? {}),
    processed: false,
  }
  try {
    await cds.run(INSERT.into(ShipmentEvents).entries(row))
    return row
  } catch {
    return null // dedupe hit on @assert.unique.event (replay/retry) — already have it, do nothing
  }
}

// async worker: match tracking → shipment, advance status for MAPPED events only.
// Unknown status = store + alert + NO state change (S6). Email trigger is task 1.13 (gated).
const ADVANCES = new Set(['pre_transit', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'])
// pickup-class = the parcel is physically with the carrier → customer email is owed (doc 08 §8)
const PICKUP_CLASS = new Set(['in_transit', 'out_for_delivery', 'delivered'])
async function processEvent(row) {
  const { SELECT, UPDATE } = cds.ql
  const { ShipmentEvents, Shipments } = cds.entities('courier')
  if (row.event_type === 'unknown') {
    LOG.warn('unknown carrier status — stored, no action (S6)', { id: row.ID, carrier_id: row.carrier_id, raw: row.event_type_raw })
    await cds.run(UPDATE(ShipmentEvents).set({ processed: true }).where({ ID: row.ID }))
    return
  }
  const ships = await cds.run(SELECT.from(Shipments).where({ tracking_number: row.tracking_number }))
  const advance = ships.length && ADVANCES.has(row.event_type)
  if (advance) {
    await cds.run(UPDATE(Shipments).set({ status: row.event_type }).where({ tracking_number: row.tracking_number, status: { '!=': 'voided' } }))
    // first_scan_at = FIRST pickup-class event (doc 08 §8) — some carrier vocabularies skip
    // straight to out_for_delivery/delivered, so this is wider than just in_transit.
    if (PICKUP_CLASS.has(row.event_type)) {
      await cds.run(
        UPDATE(Shipments).set({ first_scan_at: row.event_ts }).where({ tracking_number: row.tracking_number, first_scan_at: null })
      )
    }
  }
  // event durably handled BEFORE the email leg — a slow/hung Graph call must never gate
  // event processing (email state lives in Notifications; the nightly sweep is its backstop)
  await cds.run(UPDATE(ShipmentEvents).set({ processed: true }).where({ ID: row.ID }))
  // 1.13: ONE customer email per DO, on the first pickup-class event — the atomic claim
  // inside makes this idempotent, so firing on every such event is safe.
  if (advance && PICKUP_CLASS.has(row.event_type)) {
    try {
      await email.notifyFirstPickup(ships[0].vbeln)
    } catch (e) {
      LOG.error('email notify failed', { vbeln: ships[0].vbeln, err: e.message })
    }
  }
}

module.exports = { handle, _processEvent: processEvent, _reset: () => { hits.clear(); inflight = 0 } }
