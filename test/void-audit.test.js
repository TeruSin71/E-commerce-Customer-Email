// Task 1.11 — /void + append-only audit (S8, doc 10 §3).
// DONE criterion: void produces an audit_log row (actor, before, after); app cannot
// UPDATE/DELETE audit_log. The DB-grant half (INSERT/SELECT only) is a HANA .hdbrole
// verified at go-live; here we prove the SERVICE exposes no mutate path + the row is written.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const xsuaa = require('./helpers/xsuaa-mock')

let cds
let server
let base

before(async () => {
  xsuaa.install()
  cds = require('@sap/cds')
  cds.env.requires.auth = { kind: 'xsuaa', credentials: xsuaa.CREDS }
  server = await require('../srv/server.js')({ port: 0, in_memory: true, service: 'all', from: '*' })
  base = `http://127.0.0.1:${server.address().port}`

  const { INSERT } = cds.ql
  const { Carriers, CarrierAccounts, Routes } = cds.entities('courier')
  await cds.run(INSERT.into(Carriers).entries([{ carrier_id: 'MOCK', display_name: 'Mock', destination_name: 'MOCK_DEST', label_format: 'ZPL', active: true }]))
  await cds.run(INSERT.into(Routes).entries([{ werks: '1000', dest_country: 'DOM', carrier_id: 'MOCK', priority: 1, active: true }]))
  await cds.run(INSERT.into(CarrierAccounts).entries([{ carrier_id: 'MOCK', bukrs: '1000', valid_from: '2026-01-01', account_ref: 'CONTRACT-1000', currency: 'NZD', active: true }]))
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

const api = (path, { token, method = 'GET', body } = {}) =>
  fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
const tokenFor = (werks, scopes) =>
  xsuaa.signToken({ scope: scopes.map((s) => `${xsuaa.CREDS.xsappname}.${s}`), 'xs.user.attributes': { werks } })

async function bookOne(vbeln) {
  const res = await api('/book', { method: 'POST', token: tokenFor(['1000'], ['view', 'rate', 'book']), body: { vbeln, rateId: `MOCK-STD-${vbeln}` } })
  assert.ok(res.status < 300, `book setup failed: ${res.status}`)
}

test('S8: void marks row voided AND writes an audit row (actor, before, after)', async () => {
  const VBELN = '0080000101'
  await bookOne(VBELN)

  const res = await api('/void', { method: 'POST', token: tokenFor(['1000'], ['void']), body: { vbeln: VBELN } })
  assert.equal(res.status, 200)
  assert.equal((await res.json())[0].status, 'voided')

  const { SELECT } = cds.ql
  const { AuditLog, Shipments } = cds.entities('courier')
  const [ship] = await cds.run(SELECT.from(Shipments).where({ vbeln: VBELN }))
  assert.equal(ship.status, 'voided')

  const audits = await cds.run(SELECT.from(AuditLog).where({ action: 'void' }))
  assert.equal(audits.length, 1)
  assert.equal(audits[0].actor, 'tester')
  assert.match(audits[0].object, /0080000101/)
  assert.deepEqual(JSON.parse(audits[0].before), { status: 'booked' })
  assert.deepEqual(JSON.parse(audits[0].after), { status: 'voided' })
})

test('S8: audit module exposes no update/delete path', () => {
  const audit = require('../srv/lib/audit')
  assert.deepEqual(Object.keys(audit), ['record'])
  assert.equal(typeof audit.record, 'function')
})

test('void requires the void scope (book/view cannot void) and a right plant', async () => {
  const VBELN = '0080000102'
  await bookOne(VBELN)
  assert.equal((await api('/void', { method: 'POST', token: tokenFor(['1000'], ['book']), body: { vbeln: VBELN } })).status, 403)
  assert.equal((await api('/void', { method: 'POST', token: tokenFor(['2000'], ['void']), body: { vbeln: VBELN } })).status, 404)
})
