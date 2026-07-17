// Task 1.5 — /deliveries worklist proxy, plant-filtered from the token (doc 08 §3).
// DONE criterion: "Worklist returns test DO; wrong-plant token → empty/403."
// Runs against the REAL in-process courier-srv with REAL xssec token validation.
// ⚠ Data source is the SYNTHETIC ECC fixture (srv/lib/ecc.js) until task 1.2 binds real
// ECC — re-verify on real ECC is tagged in the task-log.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const xsuaa = require('./helpers/xsuaa-mock')

let server
let base

before(async () => {
  xsuaa.install()
  const cds = require('@sap/cds')
  cds.env.requires.auth = { kind: 'xsuaa', credentials: xsuaa.CREDS }
  server = await require('../srv/server.js')({ port: 0, in_memory: true, service: 'all', from: '*' })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

const get = (token) => fetch(`${base}/deliveries`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
const tokenFor = (werks, scopes = ['view']) =>
  xsuaa.signToken({
    scope: scopes.map((s) => `${xsuaa.CREDS.xsappname}.${s}`),
    'xs.user.attributes': { werks },
  })

test('worklist returns the test DOs for the token plant only', async () => {
  const res = await get(tokenFor(['1000']))
  assert.equal(res.status, 200)
  const rows = await res.json()
  assert.ok(rows.length >= 2, 'expected the two werks-1000 synthetic DOs')
  assert.ok(rows.every((d) => d.werks === '1000'), 'leaked a non-1000 delivery')
  const multiHu = rows.find((d) => d.vbeln === '0080000102')
  assert.equal(multiHu.hus.length, 2, 'multi-HU delivery must carry all HUs')
  assert.ok(multiHu.hus[0].weightKg > 0, 'HU must carry real weight')
})

test('wrong-plant token → empty worklist, never other-plant data', async () => {
  const res = await get(tokenFor(['9999']))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), [])
})

test('multi-plant token unions plants — and only those', async () => {
  const res = await get(tokenFor(['1000', '2000']))
  const rows = await res.json()
  assert.deepEqual([...new Set(rows.map((d) => d.werks))].sort(), ['1000', '2000'])
})

test('no view scope → 403; no token → 401', async () => {
  assert.equal((await get(tokenFor(['1000'], ['config']))).status, 403)
  assert.equal((await get()).status, 401)
})
