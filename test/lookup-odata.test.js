// S3 on the OData path (task 1.16) — the LookupService projection is a NEW read surface
// that bypasses the express repository guard, so cross-plant isolation is re-proven here
// against the REAL courier-srv with REAL xssec validation (same rig as s1-s4).
// Also proves the PII discipline of the projection: label_bytes / ship_to_email / rate
// columns must never appear in $metadata (S2/H2 leg).
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

  // one shipment per plant — the 2000 row is what a 1000 token must never see
  const { INSERT } = cds.ql
  const { Shipments } = cds.entities('courier')
  const row = (n, werks) => ({
    ID: `00000000-0000-0000-0000-0000000000a${n}`,
    vbeln: `009000000${n}`,
    exidv: `HU100${n}`,
    werks,
    bukrs: '1000',
    so_number: `002000000${n}`,
    carrier_id: 'NZPOST',
    service_code: 'CPOLE',
    tracking_number: `LKP${werks}A`,
    is_primary: true,
    rate_quoted: 10.5,
    currency: 'NZD',
    label_format: 'ZPL',
    status: 'booked',
    ship_to_name: `Lookup Receiver ${n}`,
    ship_to_country: 'NZ',
    booked_at: new Date().toISOString(),
    created_by: 'seed',
  })
  await cds.run(INSERT.into(Shipments).entries([row(1, '1000'), row(2, '2000')]))
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

const ODATA = '/odata/v4/lookup'

const call = (path, token) =>
  fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })

const tokenFor = (werks, scopes = ['view']) =>
  xsuaa.signToken({
    scope: scopes.map((s) => `${xsuaa.CREDS.xsappname}.${s}`),
    'xs.user.attributes': { werks },
  })

test('OData lookup: no token → 401 (express xssec middleware covers CAP-mounted routes)', async () => {
  const res = await call(`${ODATA}/Shipments`)
  assert.equal(res.status, 401)
})

test('OData lookup: valid token without view scope → 403', async () => {
  const res = await call(`${ODATA}/Shipments`, tokenFor(['1000'], ['book']))
  assert.equal(res.status, 403)
})

test('OData lookup: token without any werks attribute → 403 (fail closed)', async () => {
  const res = await call(`${ODATA}/Shipments`, tokenFor([]))
  assert.equal(res.status, 403)
})

test('S3 (OData leg): every lookup path is plant-isolated; positive control per plant', async () => {
  const mine = tokenFor(['1000'])

  // all three support-lookup legs for the OTHER plant's row → empty, never an error leak
  for (const filter of [
    `vbeln eq '0090000002'`,
    `tracking_number eq 'LKP2000A'`,
    `so_number eq '0020000002'`,
  ]) {
    const res = await call(`${ODATA}/Shipments?$filter=${encodeURIComponent(filter)}`, mine)
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).value, [], `cross-plant leak via $filter=${filter}`)
  }

  // by-key read of the other plant's row → 404 (indistinguishable from missing)
  const byKey = await call(`${ODATA}/Shipments(00000000-0000-0000-0000-0000000000a2)`, mine)
  assert.equal(byKey.status, 404)

  // positive control: the SAME queries return the row for its owning plant
  const own = await call(`${ODATA}/Shipments?$filter=${encodeURIComponent(`vbeln eq '0090000001'`)}`, mine)
  const rows = (await own.json()).value
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tracking_number, 'LKP1000A')

  // and a 2000 token sees its own row through the same service
  const theirs = await call(`${ODATA}/Shipments?$filter=${encodeURIComponent(`vbeln eq '0090000002'`)}`, tokenFor(['2000']))
  assert.equal((await theirs.json()).value.length, 1)

  // $count path is plant-filtered too
  const count = await call(`${ODATA}/Shipments/$count`, mine)
  assert.equal(await count.text(), '1')
})

test('S3 (OData leg): compound/alternate query shapes stay plant-isolated', async () => {
  const mine = tokenFor(['1000'])

  // $filter with OR across both plants' rows — the werks guard must AND around the whole OR
  const orLeak = await call(
    `${ODATA}/Shipments?$filter=${encodeURIComponent(`vbeln eq '0090000001' or vbeln eq '0090000002'`)}`,
    mine
  )
  const orRows = (await orLeak.json()).value
  assert.equal(orRows.length, 1, 'OR-filter leaked a cross-plant row')
  assert.equal(orRows[0].vbeln, '0090000001')

  // $batch is the request shape Fiori Elements actually sends — same isolation inside it
  const batch = await fetch(base + `${ODATA}/$batch`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${mine}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { id: '1', method: 'GET', url: `Shipments?$filter=${encodeURIComponent(`vbeln eq '0090000002'`)}` },
      ],
    }),
  })
  assert.equal(batch.status, 200)
  const inner = (await batch.json()).responses[0]
  assert.equal(inner.status, 200)
  assert.deepEqual(inner.body.value, [], 'cross-plant leak via $batch inner request')

  // malformed werks attribute (empty-string element) → fail closed, same as the repository
  const malformed = await call(`${ODATA}/Shipments`, tokenFor(['']))
  assert.equal(malformed.status, 403)
})

test('OData lookup is read-only: write attempts are rejected', async () => {
  const res = await fetch(base + `${ODATA}/Shipments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenFor(['1000'])}`, 'content-type': 'application/json' },
    body: JSON.stringify({ vbeln: '0099999999' }),
  })
  assert.ok([403, 405].includes(res.status), `write not rejected (got ${res.status})`)
})

test('projection never exposes PII/label columns ($metadata: no label_bytes, ship_to_email, rate_*)', async () => {
  const res = await call(`${ODATA}/$metadata`, tokenFor(['1000']))
  assert.equal(res.status, 200)
  const meta = await res.text()
  for (const banned of ['label_bytes', 'ship_to_email', 'rate_quoted', 'rate_billed', 'created_by']) {
    assert.ok(!meta.includes(banned), `${banned} leaked into $metadata`)
  }
  assert.ok(meta.includes('tracking_number'), 'sanity: projection serves the lookup fields')
})
