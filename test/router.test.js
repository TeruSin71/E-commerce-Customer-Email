// Task 1.6a — table-driven routing + FAIL-CLOSED contract cache (doc 08 §4.1/§5):
// no route → error; no active contract → error (NEVER a quote without the contract);
// active contract → accountRef + destination name (never a URL).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

let cds
let server
let router

before(async () => {
  cds = require('@sap/cds')
  server = await require('../srv/server.js')({ port: 0, in_memory: true, service: 'all', from: '*' })
  router = require('../srv/lib/router')

  const { INSERT } = cds.ql
  const { Carriers, CarrierAccounts, Routes } = cds.entities('courier')
  await cds.run(
    INSERT.into(Carriers).entries([
      { carrier_id: 'MOCK', display_name: 'Mock Carrier', destination_name: 'MOCK_DEST', label_format: 'ZPL', active: true },
      { carrier_id: 'DEADC', display_name: 'Inactive Carrier', destination_name: 'DEAD_DEST', label_format: 'ZPL', active: false },
    ])
  )
  await cds.run(
    INSERT.into(Routes).entries([
      { werks: '1000', dest_country: 'DOM', carrier_id: 'MOCK', priority: 1, active: true },
      { werks: '3000', dest_country: 'DOM', carrier_id: 'MOCK', priority: 1, active: true }, // plant with NO contract
      { werks: '4000', dest_country: 'DOM', carrier_id: 'DEADC', priority: 1, active: true }, // inactive carrier
    ])
  )
  await cds.run(
    INSERT.into(CarrierAccounts).entries([
      { carrier_id: 'MOCK', bukrs: '1000', valid_from: '2026-01-01', account_ref: 'CONTRACT-1000', currency: 'NZD', active: true },
    ])
  )
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

test('active route + active contract → provider id, destination NAME (no URL), accountRef', async () => {
  const r = await router.route('1000', 'NZ', '1000')
  assert.equal(r.providerId, 'MOCK')
  assert.equal(r.destinationName, 'MOCK_DEST')
  assert.equal(r.accountRef, 'CONTRACT-1000')
  assert.ok(!/https?:\/\//.test(JSON.stringify(r)), 'router output must never contain a URL (S1)')
})

test('no route for plant → fail closed', async () => {
  await assert.rejects(() => router.route('9999', 'NZ', '1000'), /no active route/)
})

test('route to inactive carrier → fail closed', async () => {
  await assert.rejects(() => router.route('4000', 'NZ', '1000'), /inactive|unknown/)
})

test('no active contract → fail closed, NEVER a contract-less quote', async () => {
  await assert.rejects(() => router.route('3000', 'NZ', '3000'), /no active carrier contract/)
})

test('mock provider registered in dev, unknown carrier fails closed', () => {
  const { providerFor } = require('../srv/providers')
  assert.equal(providerFor('MOCK').id, 'MOCK')
  assert.throws(() => providerFor('NZPOST'), /no provider registered/)
})
