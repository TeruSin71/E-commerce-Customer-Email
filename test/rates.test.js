// Task 1.7 — POST /rates: options for one delivery, contract-routed, read-only.
// DONE criterion: "Options returned for test DO using real VEKP weight" — on the SYNTHETIC
// seam the fixture HU weights stand in for VEKP; re-verify tag applies (real ECC + NZ Post).
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

const rates = (vbeln, token) =>
  fetch(`${base}/rates`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(vbeln ? { vbeln } : {}),
  })
const tokenFor = (werks, scopes) =>
  xsuaa.signToken({ scope: scopes.map((s) => `${xsuaa.CREDS.xsappname}.${s}`), 'xs.user.attributes': { werks } })

test('rate options returned for test DO using fixture HU weight', async () => {
  const res = await rates('0080000101', tokenFor(['1000'], ['view', 'rate']))
  assert.equal(res.status, 200)
  const options = await res.json()
  assert.ok(options.length >= 1)
  const [opt] = options
  // MOCK pricing: 5.00 base + 2.5/kg × 2.4 kg = 11.00 — proves the HU weight flows through
  assert.equal(opt.price, 11.0)
  assert.equal(opt.currency, 'NZD')
  assert.ok(opt.rateId)
})

test('multi-HU delivery rates on summed weight', async () => {
  const res = await rates('0080000102', tokenFor(['1000'], ['view', 'rate']))
  const [opt] = await res.json()
  // 5.00 + 2.5 × (8.1 + 1.2) = 28.25
  assert.equal(opt.price, 28.25)
})

test('other-plant delivery → 404, indistinguishable from unknown', async () => {
  const other = await rates('0080000201', tokenFor(['1000'], ['view', 'rate']))
  const unknown = await rates('0089999999', tokenFor(['1000'], ['view', 'rate']))
  assert.equal(other.status, 404)
  assert.equal(unknown.status, 404)
})

test('missing rate scope → 403; missing vbeln → 400', async () => {
  assert.equal((await rates('0080000101', tokenFor(['1000'], ['view']))).status, 403)
  assert.equal((await rates(null, tokenFor(['1000'], ['view', 'rate']))).status, 400)
})
