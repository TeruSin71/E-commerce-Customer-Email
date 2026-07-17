// Task 1.12 — /webhook/:carrier (S5, S6). Public route; its defenses are HMAC + signed
// timestamp + rate limit + body cap. Async worker advances shipment status; email is 1.13.
process.env.WEBHOOK_SECRET_MOCK = 'test-webhook-secret'
const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const xsuaa = require('./helpers/xsuaa-mock')

let cds
let server
let base
let webhook

before(async () => {
  xsuaa.install()
  cds = require('@sap/cds')
  cds.env.requires.auth = { kind: 'xsuaa', credentials: xsuaa.CREDS }
  server = await require('../srv/server.js')({ port: 0, in_memory: true, service: 'all', from: '*' })
  base = `http://127.0.0.1:${server.address().port}`
  webhook = require('../srv/lib/webhook')

  const { INSERT } = cds.ql
  const { Carriers, CarrierAccounts, Routes } = cds.entities('courier')
  await cds.run(INSERT.into(Carriers).entries([{ carrier_id: 'MOCK', display_name: 'Mock', destination_name: 'MOCK_DEST', label_format: 'ZPL', active: true }]))
  await cds.run(INSERT.into(Routes).entries([{ werks: '1000', dest_country: 'DOM', carrier_id: 'MOCK', priority: 1, active: true }]))
  await cds.run(INSERT.into(CarrierAccounts).entries([{ carrier_id: 'MOCK', bukrs: '1000', valid_from: '2026-01-01', account_ref: 'C1', currency: 'NZD', active: true }]))
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => webhook._reset())

const sign = (body, ts = Math.floor(Date.now() / 1000)) => ({
  'x-mock-timestamp': String(ts),
  'x-mock-signature': crypto.createHmac('sha256', 'test-webhook-secret').update(`${ts}.${body}`).digest('hex'),
})
const post = (body, headers) =>
  fetch(`${base}/webhook/mock`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })

const bookOne = async (vbeln) => {
  const tok = xsuaa.signToken({ scope: ['view', 'rate', 'book'].map((s) => `${xsuaa.CREDS.xsappname}.${s}`), 'xs.user.attributes': { werks: ['1000'] } })
  const r = await fetch(`${base}/book`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ vbeln, rateId: `MOCK-STD-${vbeln}` }) })
  return (await r.json())[0].tracking
}
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r))) // let the async worker run

test('S5: valid signed webhook → 200, event stored, shipment status advanced', async () => {
  const tracking = await bookOne('0080000101')
  const body = JSON.stringify({ tracking, status: 'PICKED_UP', timestamp: new Date().toISOString() })
  const res = await post(body, sign(body))
  assert.equal(res.status, 200)
  await settle()

  const { SELECT } = cds.ql
  const { ShipmentEvents, Shipments } = cds.entities('courier')
  const [evt] = await cds.run(SELECT.from(ShipmentEvents).where({ tracking_number: tracking }))
  assert.equal(evt.event_type, 'in_transit')
  const [ship] = await cds.run(SELECT.from(Shipments).where({ tracking_number: tracking }))
  assert.equal(ship.status, 'in_transit')
  assert.ok(ship.first_scan_at, 'first pickup scan timestamp recorded')
})

test('S5: replayed webhook (valid sig, stale timestamp) → 401', async () => {
  const body = JSON.stringify({ tracking: 'X', status: 'DELIVERED' })
  const stale = Math.floor(Date.now() / 1000) - 600 // 10 min old
  assert.equal((await post(body, sign(body, stale))).status, 401)
})

test('S5: tampered body (sig no longer matches) → 401', async () => {
  const body = JSON.stringify({ tracking: 'X', status: 'DELIVERED' })
  const headers = sign(body)
  assert.equal((await post(JSON.stringify({ tracking: 'X', status: 'EXCEPTION' }), headers)).status, 401)
})

test('S5: missing signature → 401', async () => {
  assert.equal((await post(JSON.stringify({ tracking: 'X', status: 'DELIVERED' }), {})).status, 401)
})

test('S5: oversized body (>256KB) → 413', async () => {
  const big = JSON.stringify({ tracking: 'X', status: 'DELIVERED', pad: 'a'.repeat(300 * 1024) })
  assert.equal((await post(big, sign(big))).status, 413)
})

test('S5: flood from one source → rate limited (429)', async () => {
  const body = JSON.stringify({ tracking: 'X', status: 'DELIVERED' })
  let sawLimit = false
  for (let i = 0; i < 130; i++) {
    const res = await post(body, {}) // unsigned; rate check runs before verify
    if (res.status === 429) { sawLimit = true; break }
  }
  assert.ok(sawLimit, 'expected a 429 within the flood')
})

test('S6: never-seen status → stored as unknown, NO status change, no error', async () => {
  const tracking = await bookOne('0080000102')
  const body = JSON.stringify({ tracking, status: 'TELEPORTED', timestamp: new Date().toISOString() })
  assert.equal((await post(body, sign(body))).status, 200)
  await settle()

  const { SELECT } = cds.ql
  const { ShipmentEvents, Shipments } = cds.entities('courier')
  const [evt] = await cds.run(SELECT.from(ShipmentEvents).where({ tracking_number: tracking }))
  assert.equal(evt.event_type, 'unknown')
  assert.equal(evt.processed, true)
  const [ship] = await cds.run(SELECT.from(Shipments).where({ tracking_number: tracking }))
  assert.equal(ship.status, 'booked', 'unknown status must NOT change shipment state (fail closed)')
})

test('S5/dedupe: same event delivered twice → one stored row', async () => {
  const ts = new Date('2026-07-17T02:00:00Z').toISOString()
  const body = JSON.stringify({ tracking: 'DEDUPE1', status: 'DELIVERED', timestamp: ts })
  await post(body, sign(body))
  await post(body, sign(body))
  await settle()
  const { SELECT } = cds.ql
  const { ShipmentEvents } = cds.entities('courier')
  const rows = await cds.run(SELECT.from(ShipmentEvents).where({ tracking_number: 'DEDUPE1' }))
  assert.equal(rows.length, 1, 'dedupe key (tracking, event_type_raw, event_ts) collapses replays')
})
