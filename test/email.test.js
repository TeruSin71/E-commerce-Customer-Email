// 1.13 — email on first pickup (doc 08 §8). DONE criterion: ONE email exactly per DO;
// race test (3 concurrent events) sends one. Plus: S11 escaping of carrier strings,
// fail-closed when GRAPH is not configured (no send AND no claim), multi-HU = all
// tracking numbers in one email, and the DO number NEVER appears.
const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')

const cds = require('@sap/cds')
const email = require('../srv/lib/email')

const VBELN = '0080000777'
const GRAPH_CREDS = { tenantId: 't', clientId: 'c', clientSecret: 's', sender: 'noreply@example.test' }

let sent = [] // captured by the spy transport

let db

before(async () => {
  cds.model = cds.compile.for.nodejs(await cds.load('db/schema.cds'))
  db = await cds.connect.to('db') // in-memory sqlite from cds.requires.db; no HTTP server needed
  await cds.deploy(cds.model).to(db)
  email._setTransport(async (cfg, mail) => {
    sent.push({ cfg, mail })
  })
})

after(async () => {
  email._setTransport(null)
  if (db && db.disconnect) await db.disconnect()
})

beforeEach(async () => {
  sent = []
  cds.env.requires.graph = { credentials: GRAPH_CREDS }
  const { DELETE, INSERT } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')
  await cds.run(DELETE.from(Shipments))
  await cds.run(DELETE.from(Notifications))
  // one delivery, TWO HUs (multi-HU leg), hostile chars in a carrier-sourced string (S11)
  const row = (n, tracking, isPrimary) => ({
    ID: `00000000-0000-0000-0000-00000000077${n}`,
    vbeln: VBELN,
    exidv: `HU77${n}`,
    werks: '1000',
    bukrs: '1000',
    so_number: '0010000777',
    carrier_id: 'MOCK',
    service_code: 'MOCK-STD',
    tracking_number: tracking,
    is_primary: isPrimary,
    rate_quoted: 10,
    currency: 'NZD',
    label_format: 'ZPL',
    status: 'booked',
    ship_to_name: 'Test Receiver',
    ship_to_email: 'terulin.sinulingga@gallagher.com',
    ship_to_country: 'NZ',
    booked_at: new Date().toISOString(),
    created_by: 'seed',
  })
  // secondary HU inserted FIRST — the primary-first assertion must not pass by insertion order
  await cds.run(INSERT.into(Shipments).entries([row(2, 'MOCKTRK2', false), row(1, 'MOCKTRK<b>"x&', true)]))
})

test('race: 3 concurrent pickup notifications → exactly ONE email', async () => {
  const results = await Promise.all([
    email.notifyFirstPickup(VBELN),
    email.notifyFirstPickup(VBELN),
    email.notifyFirstPickup(VBELN),
  ])
  assert.equal(sent.length, 1, `expected exactly one send, got ${sent.length}`)
  assert.equal(results.filter((r) => r.sent).length, 1)
  // and a later straggler event sends nothing more
  const again = await email.notifyFirstPickup(VBELN)
  assert.equal(again.sent, false)
  assert.equal(again.reason, 'already_sent')
  assert.equal(sent.length, 1)
})

test('content: SO number + BOTH trackings (primary first), NEVER the DO number, S11-escaped', async () => {
  await email.notifyFirstPickup(VBELN)
  assert.equal(sent.length, 1)
  const { mail } = sent[0]
  assert.equal(mail.to, 'terulin.sinulingga@gallagher.com')
  assert.ok(mail.subject.includes('0010000777'), 'subject carries the SO number')
  assert.ok(mail.html.includes('0010000777'), 'body carries the SO number')
  assert.ok(!mail.subject.includes(VBELN) && !mail.html.includes(VBELN), 'DO number must never appear')
  assert.ok(mail.html.includes('MOCKTRK2'), 'multi-HU: second tracking present')
  // hostile carrier string is escaped, raw form absent (S11)
  assert.ok(mail.html.includes('MOCKTRK&lt;b&gt;&quot;x&amp;'), 'tracking rendered escaped')
  assert.ok(!mail.html.includes('MOCKTRK<b>'), 'raw hostile tracking must not reach the HTML')
  // primary tracking listed before the secondary
  assert.ok(mail.html.indexOf('MOCKTRK&lt;') < mail.html.indexOf('MOCKTRK2'), 'primary first')
})

test('GRAPH not configured → fail closed: no send, NO claim (retries when bound)', async () => {
  delete cds.env.requires.graph
  const r = await email.notifyFirstPickup(VBELN)
  assert.deepEqual(r, { sent: false, reason: 'graph_not_configured' })
  assert.equal(sent.length, 0)
  // claim was NOT taken — once configured, the email still goes out
  cds.env.requires.graph = { credentials: GRAPH_CREDS }
  const r2 = await email.notifyFirstPickup(VBELN)
  assert.equal(r2.sent, true)
  assert.equal(sent.length, 1)
})

test('send failure: claim stays taken (at-most-once), failure recorded on Notifications', async () => {
  email._setTransport(async () => {
    throw new Error('boom 502')
  })
  const r = await email.notifyFirstPickup(VBELN)
  assert.deepEqual(r, { sent: false, reason: 'send_failed' })
  const { SELECT } = cds.ql
  const { Notifications } = cds.entities('courier')
  const [n] = await cds.run(SELECT.from(Notifications).where({ vbeln: VBELN }))
  assert.equal(n.sent, true, 'claim stays taken — never retry into the void')
  assert.equal(n.bounced, true)
  assert.ok(n.bounce_info.includes('boom 502'))
  // restore spy + no second email is possible
  email._setTransport(async (cfg, mail) => sent.push({ cfg, mail }))
  const r2 = await email.notifyFirstPickup(VBELN)
  assert.equal(r2.reason, 'already_sent')
  assert.equal(sent.length, 0)
})

test('webhook path: in_transit event → status advance + exactly one email through processEvent', async () => {
  const webhook = require('../srv/lib/webhook')
  const { INSERT, SELECT } = cds.ql
  const { ShipmentEvents, Shipments } = cds.entities('courier')
  const evRow = (n) => ({
    ID: `00000000-0000-0000-0000-0000000007e${n}`,
    carrier_id: 'MOCK',
    tracking_number: 'MOCKTRK2',
    event_type_raw: 'PICKED_UP',
    event_type: 'in_transit',
    event_ts: new Date(Date.now() + n).toISOString(), // distinct ts — the DB dedupe guard is S6's job, this tests the worker race
    payload: '{}',
    processed: false,
  })
  // three duplicate-ish pickup events processed concurrently (webhook retries/replays)
  const rows = [evRow(1), evRow(2), evRow(3)]
  await cds.run(INSERT.into(ShipmentEvents).entries(rows))
  await Promise.all(rows.map((r) => webhook._processEvent(r)))
  assert.equal(sent.length, 1, 'one email through the webhook worker path')
  const [ship] = await cds.run(SELECT.from(Shipments).where({ tracking_number: 'MOCKTRK2' }))
  assert.equal(ship.status, 'in_transit')
  assert.ok(ship.first_scan_at, 'first_scan_at stamped')
})

test('pickup-class widening: carrier vocab that skips in_transit (straight to delivered) still emails once', async () => {
  const webhook = require('../srv/lib/webhook')
  const { INSERT, SELECT } = cds.ql
  const { ShipmentEvents, Shipments } = cds.entities('courier')
  const ev = {
    ID: '00000000-0000-0000-0000-0000000007f1',
    carrier_id: 'MOCK',
    tracking_number: 'MOCKTRK2',
    event_type_raw: 'DELIVERED',
    event_type: 'delivered',
    event_ts: new Date().toISOString(),
    payload: '{}',
    processed: false,
  }
  await cds.run(INSERT.into(ShipmentEvents).entries(ev))
  await webhook._processEvent(ev)
  assert.equal(sent.length, 1, 'delivered (pickup-class) triggers the one email')
  const [ship] = await cds.run(SELECT.from(Shipments).where({ tracking_number: 'MOCKTRK2' }))
  assert.equal(ship.status, 'delivered')
  assert.ok(ship.first_scan_at, 'first pickup-class event stamps first_scan_at')
  // the event row was processed even though the email ran after (durability-first ordering)
  const [evRow] = await cds.run(SELECT.from(ShipmentEvents).where({ ID: ev.ID }))
  assert.equal(Boolean(evRow.processed), true)
})

test('unnotified sweep: pickup arrived while GRAPH unbound → nightly job sends it once bound', async () => {
  const jobs = require('../srv/lib/jobs')
  const { UPDATE } = cds.ql
  const { Shipments } = cds.entities('courier')
  // simulate: scan processed while Graph was unconfigured — status advanced, no email
  await cds.run(UPDATE(Shipments).set({ status: 'in_transit', first_scan_at: new Date().toISOString() }).where({ vbeln: VBELN }))
  delete cds.env.requires.graph
  const dry = await email.notifyFirstPickup(VBELN)
  assert.equal(dry.reason, 'graph_not_configured')
  assert.equal(sent.length, 0)
  // GRAPH gets bound later → the sweep re-drives the send exactly once
  cds.env.requires.graph = { credentials: GRAPH_CREDS }
  const r1 = await jobs.findUnnotified()
  assert.equal(r1.retried, 1)
  assert.equal(sent.length, 1)
  // idempotent: second sweep sends nothing more
  const r2 = await jobs.findUnnotified()
  assert.equal(r2.retried, 0)
  assert.equal(sent.length, 1)
})

test('unnotified sweep: claim taken but send unconfirmed (crash window) is FLAGGED, never resent', async () => {
  const jobs = require('../srv/lib/jobs')
  const { INSERT, UPDATE } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')
  await cds.run(UPDATE(Shipments).set({ status: 'in_transit', first_scan_at: new Date().toISOString() }).where({ vbeln: VBELN }))
  // claim exists (sent=true) but sent_at was never written — the crash window
  await cds.run(INSERT.into(Notifications).entries({ vbeln: VBELN, email: 'terulin.sinulingga@gallagher.com', sent: true }))
  const r = await jobs.findUnnotified()
  assert.equal(r.unconfirmed, 1, 'crash-window row flagged')
  assert.equal(r.retried, 0)
  assert.equal(sent.length, 0, 'at-most-once: never auto-resent')
})
