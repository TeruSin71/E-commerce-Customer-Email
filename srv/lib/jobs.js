// Scheduled jobs (doc 08 §7 fallback poller + doc 09 §4 / S10 purge). Pure, testable
// functions — `now` and window are injected so tests use backdated fixtures. Scheduling is
// deploy-time: the CF Job Scheduler (or `cf run-task`) invokes srv/jobs-run.js nightly.
// ponytail: no cron dep, no setInterval (a restart would reset the timer) — CF schedules it.
const cds = require('@sap/cds')
const LOG = cds.log('jobs')

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

module.exports = { purgePII, findStalled, RETENTION_DAYS }
