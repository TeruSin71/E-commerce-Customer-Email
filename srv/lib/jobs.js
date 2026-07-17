// Scheduled jobs (doc 08 §7 fallback poller + doc 09 §4 / S10 purge). Pure, testable
// functions — `now` and window are injected so tests use backdated fixtures. Scheduling is
// deploy-time: the CF Job Scheduler (or `cf run-task`) invokes srv/jobs-run.js nightly.
// ponytail: no cron dep, no setInterval (a restart would reset the timer) — CF schedules it.
const cds = require('@sap/cds')
const email = require('./email')
const LOG = cds.log('jobs')

// Statuses that mean the parcel HAS been picked up — so the customer email is owed.
const PICKED_UP = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned']

const DAY_MS = 24 * 60 * 60 * 1000
// Open Item #11 confirms the number; 24 months is the design proposal. Job runs regardless.
const RETENTION_DAYS = Number(process.env.PII_RETENTION_DAYS) || 730
const PURGED = '[purged]'

// S10 — null PII past the retention window; keep financial/tracking fields for tax.
// Idempotent: rows already scrubbed (ship_to_name = PURGED) are skipped, so re-runs are no-ops.
async function purgePII({ now = new Date(), retentionDays = RETENTION_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString()
  const { SELECT, UPDATE, DELETE } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')

  const stale = SELECT.from(Shipments).columns('vbeln').where({ booked_at: { '<': cutoff }, ship_to_name: { '!=': PURGED } })
  const vbelns = [...new Set((await cds.run(stale)).map((r) => r.vbeln))]
  if (!vbelns.length) return { shipmentsPurged: 0, notificationsPurged: 0 }

  const shipmentsPurged = await cds.run(
    UPDATE(Shipments)
      .set({ ship_to_name: PURGED, ship_to_email: null, label_bytes: null })
      .where({ booked_at: { '<': cutoff }, ship_to_name: { '!=': PURGED } })
  )
  const notificationsPurged = await cds.run(DELETE.from(Notifications).where({ vbeln: { in: vbelns } }))
  LOG.warn('PII purge complete', { cutoff, shipmentsPurged, notificationsPurged }) // counts only — no PII (S9)
  return { shipmentsPurged, notificationsPurged }
}

// Fallback poller (doc 08 §7): booked >24h ago, never scanned, still pre-transit → alert list.
// Phase 1 = record/alert only (no thresholds yet). Catches silent webhook failure.
async function findStalled({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString()
  const { SELECT } = cds.ql
  const { Shipments } = cds.entities('courier')
  const rows = await cds.run(
    SELECT.from(Shipments)
      .columns('ID', 'vbeln', 'werks', 'tracking_number', 'status', 'booked_at')
      .where({ booked_at: { '<': cutoff }, first_scan_at: null, status: { in: ['booked', 'printed', 'pgi'] } })
  )
  if (rows.length) LOG.warn('stalled shipments — no pickup scan >24h', { count: rows.length })
  return rows
}

// Unnotified sweep (task 1.13 backstop): a picked-up delivery that never got its email —
// because GRAPH was unbound at scan time, or the process died between claim and send.
// This is the retry path the per-event trigger can't provide (once first_scan_at is set,
// no new in_transit event re-fires notify). Runs nightly beside the poller.
//   - no Notifications row, or sent=false  → not yet sent → (re)drive notifyFirstPickup
//   - sent=true, sent_at=null              → claim taken but send never confirmed (crash
//                                            window): FLAG only, never auto-resend (at-most-once)
async function findUnnotified({ send = email.notifyFirstPickup } = {}) {
  const { SELECT } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')
  const shipped = await cds.run(
    SELECT.from(Shipments).columns('vbeln').where({ status: { in: PICKED_UP } })
  )
  const vbelns = [...new Set(shipped.map((r) => r.vbeln))]
  if (!vbelns.length) return { retried: 0, unconfirmed: 0 }

  const notes = await cds.run(SELECT.from(Notifications).columns('vbeln', 'sent', 'sent_at').where({ vbeln: { in: vbelns } }))
  const byVbeln = new Map(notes.map((n) => [n.vbeln, n]))

  let retried = 0
  const unconfirmed = []
  for (const vbeln of vbelns) {
    const n = byVbeln.get(vbeln)
    if (n && n.sent && !n.sent_at) {
      unconfirmed.push(vbeln) // claimed-but-unconfirmed: at-most-once, do NOT resend
      continue
    }
    if (!n || !n.sent) {
      const r = await send(vbeln) // idempotent: the atomic claim guards a concurrent event
      if (r?.sent) retried += 1
    }
  }
  if (unconfirmed.length) LOG.warn('notifications claimed but never confirmed sent', { count: unconfirmed.length })
  if (retried) LOG.info('unnotified sweep re-sent pickup emails', { retried })
  return { retried, unconfirmed: unconfirmed.length }
}

module.exports = { purgePII, findStalled, findUnnotified, RETENTION_DAYS }
