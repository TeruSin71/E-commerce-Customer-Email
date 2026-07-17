// Task 1.14 — purge job (S10) + fallback poller (doc 08 §7).
// DONE criterion: "S10 green with backdated fixtures." now is injected so we can backdate rows.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

let cds
let jobs

const DAY = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

let db

before(async () => {
  cds = require('@sap/cds')
  cds.model = cds.compile.for.nodejs(await cds.load('db/schema.cds'))
  db = await cds.connect.to('db') // in-memory sqlite from cds.requires.db; no HTTP server needed
  await cds.deploy(cds.model).to(db)
  jobs = require('../srv/lib/jobs')
})

after(async () => {
  if (db && db.disconnect) await db.disconnect()
})

const shipment = (over) => ({
  ID: cds.utils.uuid(),
  vbeln: over.vbeln,
  exidv: over.exidv || 'HU1',
  werks: '1000',
  bukrs: '1000',
  so_number: 'SO1',
  carrier_id: 'MOCK',
  service_code: 'X',
  tracking_number: over.tracking || 'TRK',
  rate_quoted: 12.5,
  currency: 'NZD',
  label_bytes: Buffer.from('^XALABEL^XZ'),
  label_format: 'ZPL',
  status: over.status || 'booked',
  ship_to_name: 'Jane Doe',
  ship_to_email: 'jane@example.com',
  ship_to_country: 'NZ',
  booked_at: over.booked_at,
  first_scan_at: over.first_scan_at || null,
  created_by: 'seed',
})

test('S10: purge nulls PII past the window, keeps financial fields, deletes Notifications', async () => {
  const now = new Date('2026-07-17T00:00:00Z')
  const { INSERT, SELECT } = cds.ql
  const { Shipments, Notifications } = cds.entities('courier')

  // one row 800 days old (past 730), one row 10 days old (inside window)
  await cds.run(INSERT.into(Shipments).entries([
    shipment({ vbeln: 'OLD001', tracking: 'TRKOLD', booked_at: iso(now.getTime() - 800 * DAY) }),
    shipment({ vbeln: 'NEW001', tracking: 'TRKNEW', booked_at: iso(now.getTime() - 10 * DAY) }),
  ]))
  await cds.run(INSERT.into(Notifications).entries([
    { vbeln: 'OLD001', email: 'jane@example.com', sent: true, sent_at: iso(now.getTime() - 800 * DAY) },
    { vbeln: 'NEW001', email: 'ben@example.com', sent: true, sent_at: iso(now.getTime() - 10 * DAY) },
  ]))

  const res = await jobs.purgePII({ now })
  assert.equal(res.shipmentsPurged, 1)
  assert.equal(res.notificationsPurged, 1)

  const [old] = await cds.run(SELECT.from(Shipments).where({ vbeln: 'OLD001' }))
  assert.equal(old.ship_to_name, '[purged]', 'name nulled')
  assert.equal(old.ship_to_email, null, 'email nulled')
  assert.equal(old.rate_quoted, 12.5, 'financial field kept for tax')
  assert.equal(old.tracking_number, 'TRKOLD', 'tracking kept')
  const [oldLabel] = await cds.run(SELECT.columns('label_bytes').from(Shipments).where({ vbeln: 'OLD001' }))
  assert.equal(oldLabel.label_bytes, null, 'label bytes purged')

  const [fresh] = await cds.run(SELECT.from(Shipments).where({ vbeln: 'NEW001' }))
  assert.equal(fresh.ship_to_name, 'Jane Doe', 'in-window row untouched')

  const notifs = await cds.run(SELECT.from(Notifications))
  assert.deepEqual(notifs.map((n) => n.vbeln), ['NEW001'], 'old Notifications deleted, recent kept')
})

test('S10: purge is idempotent — a second run purges nothing', async () => {
  const now = new Date('2026-07-17T00:00:00Z')
  const again = await jobs.purgePII({ now })
  assert.equal(again.shipmentsPurged, 0)
  assert.equal(again.notificationsPurged, 0)
})

test('fallback poller flags booked >24h with no scan; ignores scanned/recent/advanced', async () => {
  const now = new Date('2026-07-17T00:00:00Z')
  const { INSERT } = cds.ql
  const { Shipments } = cds.entities('courier')
  await cds.run(INSERT.into(Shipments).entries([
    shipment({ vbeln: 'STALL1', tracking: 'TS1', booked_at: iso(now.getTime() - 2 * DAY) }), // stalled
    shipment({ vbeln: 'FRESH1', tracking: 'TF1', booked_at: iso(now.getTime() - 2 * 60 * 60 * 1000) }), // 2h, recent
    shipment({ vbeln: 'SCAN1', tracking: 'TSC1', booked_at: iso(now.getTime() - 3 * DAY), first_scan_at: iso(now.getTime() - 2 * DAY) }), // scanned
    shipment({ vbeln: 'MOVED1', tracking: 'TM1', booked_at: iso(now.getTime() - 3 * DAY), status: 'in_transit' }), // advanced
  ]))
  const stalled = await jobs.findStalled({ now })
  const vbelns = stalled.map((s) => s.vbeln)
  assert.ok(vbelns.includes('STALL1'), 'stalled shipment must be flagged')
  assert.ok(!vbelns.includes('FRESH1'), 'recent must not be flagged')
  assert.ok(!vbelns.includes('SCAN1'), 'scanned must not be flagged')
  assert.ok(!vbelns.includes('MOVED1'), 'advanced must not be flagged')
})
