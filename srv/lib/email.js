// Customer email on first pickup scan (task 1.13, doc 08 §8). Exactly ONE email per
// delivery (DO-level atomic claim on Notifications: UPDATE..WHERE sent=false, rowcount
// decides the winner). Content: SO number + tracking link(s) — NEVER the DO number.
// Carrier strings are UNTRUSTED → escaped before render (S11). Send failures are
// recorded on Notifications (bounced/bounce_info) and NOT retried into the void — the
// claim stays taken; at-most-once beats double-emailing a customer (doc 08 §8).
// sent_at is the delivery-confirmed marker: sent=true with sent_at=null means the claim
// was taken but the send never confirmed (crash window) — the nightly job flags those.
// Graph secret lives in the GRAPH destination binding ONLY (never code/env-committed).
// Not configured → fail closed: log, send nothing, DON'T claim — the nightly
// unnotified-sweep (srv/lib/jobs.js findUnnotified) re-drives the send once bound.
const cds = require('@sap/cds')
const { providerFor } = require('../providers')
const LOG = cds.log('email')

const FETCH_TIMEOUT_MS = 10_000 // a hung Graph call must never pin the webhook worker

// ── S11: the 5-char HTML escape — applied to EVERY interpolated string ──
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c])
}

// Graph client-credentials config — bound at deploy (destination / VCAP), absent in dev.
// ponytail: sender is one config value for now; per-plant senders = Phase 3 config task.
function graphConfig() {
  const c = cds.env.requires?.graph?.credentials
  return c?.tenantId && c?.clientId && c?.clientSecret && c?.sender ? c : null
}

// ── transport: token fetch + sendMail, plain fetch, no mail lib. Injectable for tests. ──
async function graphTransport(cfg, { to, subject, html }) {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  })
  if (!tokenRes.ok) throw new Error(`graph token ${tokenRes.status}`)
  const { access_token } = await tokenRes.json()
  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender)}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  })
  if (!sendRes.ok) throw new Error(`graph sendMail ${sendRes.status}`)
}

let transport = graphTransport

// One email per DO, triggered by every pickup-class event — the claim makes it idempotent.
async function notifyFirstPickup(vbeln) {
  const cfg = graphConfig()
  if (!cfg) {
    // fail closed, no claim — the nightly unnotified-sweep sends it once GRAPH is bound
    LOG.warn('GRAPH not configured — customer email skipped, claim NOT taken', { vbeln })
    return { sent: false, reason: 'graph_not_configured' }
  }

  const { SELECT, INSERT, UPDATE } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')
  const rows = await cds.run(SELECT.from(Shipments).where({ vbeln, status: { '!=': 'voided' } }))
  if (!rows.length) return { sent: false, reason: 'no_shipments' }
  const to = rows[0].ship_to_email
  if (!to) {
    LOG.error('shipment has no ship-to email — cannot notify', { vbeln }) // no address in log (S9)
    return { sent: false, reason: 'no_email' }
  }

  // ensure the DO-level row exists, then take the atomic claim (doc 08 §8: exactly once).
  // The catch is NOT "any error is a duplicate": verify the row exists, else fail visibly.
  try {
    await cds.run(INSERT.into(Notifications).entries({ vbeln, email: to, sent: false }))
  } catch {
    const [existing] = await cds.run(SELECT.from(Notifications).where({ vbeln }))
    if (!existing) {
      LOG.error('Notifications insert failed and no row exists — claim not taken', { vbeln })
      return { sent: false, reason: 'claim_error' } // no claim → the nightly sweep retries
    }
  }
  // rowcount must be EXACTLY 1 — anything else (0 = lost the race; undefined/object on a
  // future adapter change = unknown) fails closed to no-send rather than risking a duplicate.
  const claimed = await cds.run(UPDATE(Notifications).set({ sent: true }).where({ vbeln, sent: false }))
  if (claimed !== 1) return { sent: false, reason: 'already_sent' }

  // content: SO number (customer-known) + ALL tracking numbers, primary first. NEVER the DO no.
  // Number() coercion matches booking.js toResponse — SQLite returns is_primary as 0/1.
  const sorted = [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  const soNumber = sorted[0].so_number
  const so = escapeHtml(soNumber)
  const lines = sorted
    .map((r) => {
      let url
      try {
        // guard stays: a provider deregistered by a later deploy must not kill the email
        url = providerFor(r.carrier_id).trackingUrl?.(r.tracking_number)
      } catch {
        url = null
      }
      const t = escapeHtml(r.tracking_number)
      // url comes from OUR provider code (not carrier data) — attribute-escaped anyway
      return url ? `<li><a href="${escapeHtml(url)}">${t}</a></li>` : `<li>${t}</li>`
    })
    .join('')
  const mail = {
    to,
    subject: `Your order ${soNumber} is on its way`,
    html: `<p>Good news — your order <b>${so}</b> has been picked up by the courier.</p><p>Track your parcel${sorted.length > 1 ? 's' : ''}:</p><ul>${lines}</ul>`,
  }

  try {
    await transport(cfg, mail)
    // sent_at = send CONFIRMED. A crash between the claim and here leaves sent_at null —
    // the nightly job flags those rows (visible, not auto-resent: at-most-once).
    await cds.run(UPDATE(Notifications).set({ sent_at: new Date().toISOString() }).where({ vbeln }))
    LOG.info('customer email sent', { vbeln }) // counts only, no PII (S9)
    return { sent: true }
  } catch (e) {
    // claim stays taken: at-most-once. Failure is visible in Notifications (doc 08 §8 bounces).
    await cds.run(UPDATE(Notifications).set({ bounced: true, bounce_info: `send failed: ${e.message}`.slice(0, 500) }).where({ vbeln }))
    LOG.error('customer email send failed', { vbeln, err: e.message })
    return { sent: false, reason: 'send_failed' }
  }
}

module.exports = {
  notifyFirstPickup,
  escapeHtml,
  _setTransport: (fn) => {
    transport = fn || graphTransport
  },
}
