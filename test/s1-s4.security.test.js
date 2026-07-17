// S1–S4 (docs/10 §3) — TEST-FIRST, written before their implementations (task 1.4).
// Each test is marked { todo: 'red until task 1.x' }: it RUNS in CI and its failure is
// recorded visibly as a failing TODO, without blocking the merge gate. The implementing
// task (1.6 / 1.8 / 1.9 / 1.10) removes the todo marker — from then on the test MUST pass.
// NEVER weaken these asserts to make them pass (doc 14 §2.1 rule 1).
//
// Harness: the REAL courier-srv (srv/server.js) booted in-process on an ephemeral port,
// with REAL @sap/xssec token validation (offline JWKS interception, test/helpers/xsuaa-mock).
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

  // seed one shipment per plant so cross-plant reads have something to leak
  const { INSERT } = cds.ql
  const { Shipments } = cds.entities('courier')
  const row = (n, werks) => ({
    ID: `00000000-0000-0000-0000-00000000000${n}`,
    vbeln: `008000000${n}`,
    exidv: `HU000${n}`,
    werks,
    bukrs: '1000',
    so_number: `001000000${n}`,
    carrier_id: 'NZPOST',
    service_code: 'CPOLE',
    tracking_number: `TRK${werks}A`,
    is_primary: true,
    rate_quoted: 10.5,
    currency: 'NZD',
    label_format: 'ZPL',
    status: 'booked',
    ship_to_name: `Test Receiver ${n}`,
    ship_to_country: 'NZ',
    booked_at: new Date().toISOString(),
    created_by: 'seed',
  })
  await cds.run(INSERT.into(Shipments).entries([row(1, '1000'), row(2, '2000')]))

  // routing config so the /book money path can run against the MOCK carrier
  const { Carriers, CarrierAccounts, Routes } = cds.entities('courier')
  await cds.run(INSERT.into(Carriers).entries([{ carrier_id: 'MOCK', display_name: 'Mock', destination_name: 'MOCK_DEST', label_format: 'ZPL', active: true }]))
  await cds.run(INSERT.into(Routes).entries([{ werks: '1000', dest_country: 'DOM', carrier_id: 'MOCK', priority: 1, active: true }]))
  await cds.run(INSERT.into(CarrierAccounts).entries([{ carrier_id: 'MOCK', bukrs: '1000', valid_from: '2026-01-01', account_ref: 'CONTRACT-1000', currency: 'NZD', active: true }]))
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

const call = (path, { token, method = 'GET', body } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const tokenFor = (werks, scopes) =>
  xsuaa.signToken({
    scope: scopes.map((s) => `${xsuaa.CREDS.xsappname}.${s}`),
    'xs.user.attributes': { werks },
  })

// ── S1 — carrier URLs only ever come from bound destinations; hostile/private refused ──
// todo marker removed in task 1.6a — this test now GATES merges.
test('S1: destination-only carrier URLs; private/link-local ranges refused', () => {
  let destinations
  assert.doesNotThrow(() => {
    destinations = require('../srv/lib/destinations')
  }, 'srv/lib/destinations missing — carrier URL resolution not implemented yet')
  const { assertAllowedCarrierUrl } = destinations
  // URL not from the bound destination → refused
  assert.throws(() => assertAllowedCarrierUrl('https://evil.example.com/api', { destinationUrl: 'https://api.nzpost.co.nz' }))
  // private / link-local / loopback ranges → refused (defense in depth, doc 08 §5)
  for (const hostile of [
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/api',
    'http://172.16.1.1/api',
    'http://192.168.1.1/api',
    'http://127.0.0.1:8080/api',
    'http://localhost/api',
  ]) {
    assert.throws(() => assertAllowedCarrierUrl(hostile, { destinationUrl: hostile }), `accepted hostile URL: ${hostile}`)
  }
  // the destination's own URL passes
  assert.doesNotThrow(() => assertAllowedCarrierUrl('https://api.nzpost.co.nz/rates', { destinationUrl: 'https://api.nzpost.co.nz' }))
})

// ── S2 — label bytes only via authenticated, plant-checked route ──
// todo marker removed in task 1.9 — this test now GATES merges. It books a real DO first so
// the label id is one the system minted, then exercises the download auth legs.
test('S2: /label/:id — 401 without token, 403 wrong plant, stored bytes (never a URL) for right plant', async () => {
  const VBELN = '0080000102' // fixture DO, werks 1000
  const booked = await call('/book', {
    method: 'POST',
    token: tokenFor(['1000'], ['view', 'rate', 'book']),
    body: { vbeln: VBELN, rateId: `MOCK-STD-${VBELN}` },
  })
  assert.ok(booked.status < 300, `book setup failed: ${booked.status}`)
  const labelRef = (await booked.json())[0].zplRef // "/label/<uuid>"

  const noToken = await call(labelRef)
  assert.equal(noToken.status, 401, 'unauthenticated label download must be 401')

  const wrongPlant = await call(labelRef, { token: tokenFor(['2000'], ['view', 'reprint']) })
  assert.equal(wrongPlant.status, 404, 'other-plant label must be indistinguishable from missing (404, no leak)')

  const rightPlant = await call(labelRef, { token: tokenFor(['1000'], ['view', 'reprint']) })
  assert.equal(rightPlant.status, 200, 'right-plant label download must serve stored bytes')
  const body = await rightPlant.text()
  assert.ok(body.length > 0, 'label bytes must be served')
  assert.ok(!/https?:\/\//.test(body), 'label response must be stored bytes, never a carrier URL (H2)')
})

// grep-style guard for S2/H2: no carrier label URL is ever stored or returned
test('S2: label bytes column holds ZPL, not a URL', async () => {
  const { SELECT } = cds.ql
  const { Shipments } = cds.entities('courier')
  const rows = await cds.run(SELECT.columns('ID', 'label_bytes').from(Shipments).where({ vbeln: '0080000102' }))
  assert.ok(rows.length > 0, 'expected booked shipments to inspect')
  for (const r of rows) {
    if (!r.label_bytes) continue
    const chunks = []
    for await (const chunk of r.label_bytes) chunks.push(chunk) // drain the LargeBinary stream
    const content = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString()
    assert.ok(content.length > 0, 'label bytes must be present')
    assert.ok(!/https?:\/\//.test(content), 'label_bytes must never contain a URL')
  }
})

// ── S3 — cross-plant reads return nothing on EVERY read path ──
test('S3: werks=[1000] token cannot read werks=2000 data via any read path', { todo: 'red until task 1.10 (read routes via plant-scoped repo)' }, async () => {
  const token = tokenFor(['1000'], ['view', 'reprint'])
  for (const path of [
    '/shipments?vbeln=0080000002',
    '/shipments?tracking=TRK2000A',
    '/shipments?so=0010000002',
    '/dashboard',
  ]) {
    const res = await call(path, { token })
    assert.ok([200, 403].includes(res.status), `${path}: expected 200(filtered)/403, got ${res.status}`)
    if (res.status === 200) {
      const text = await res.text()
      assert.ok(!text.includes('TRK2000A'), `${path} leaked other-plant tracking number`)
      assert.ok(!text.includes('Test Receiver 2'), `${path} leaked other-plant PII`)
    }
  }
  const reprint = await call('/reprint', { method: 'POST', token, body: { vbeln: '0080000002' } })
  assert.equal(reprint.status, 403, '/reprint for other-plant delivery must be 403')
})

// ── S4 — double-booking impossible: concurrent /book collapses to ONE booking ──
// todo marker removed in task 1.8 — this test now GATES merges.
test('S4: concurrent /book for same (vbeln,exidv) yields one booking; idempotency key replays first result', async () => {
  const token = tokenFor(['1000'], ['view', 'rate', 'book'])
  const VBELN = '0080000101' // synthetic ECC fixture DO, werks 1000, single HU
  const bookReq = (idempotencyKey) =>
    call('/book', { method: 'POST', token, body: { vbeln: VBELN, rateId: `MOCK-STD-${VBELN}`, idempotencyKey } })

  // spy on the mock carrier: S4 demands exactly ONE carrier booking call
  const mock = require('../srv/providers/mock')
  const realBook = mock.book
  let carrierCalls = 0
  mock.book = (...args) => {
    carrierCalls += 1
    return realBook.apply(mock, args)
  }
  try {
    const [a, b] = await Promise.all([bookReq('key-1'), bookReq('key-2')])
    assert.ok(a.status < 300 && b.status < 300, `both bookings must succeed (got ${a.status}/${b.status})`)
    const [bodyA, bodyB] = [await a.json(), await b.json()]
    assert.deepEqual(
      bodyA.map((r) => r.tracking).sort(),
      bodyB.map((r) => r.tracking).sort(),
      'second booking must receive the FIRST booking, not a new one'
    )
    assert.equal(carrierCalls, 1, 'exactly ONE carrier call for concurrent /book of the same DO')

    // replay with the same idempotency key → identical response, no new booking
    const replay = await bookReq('key-1')
    assert.ok(replay.status < 300)
    assert.deepEqual(await replay.json(), bodyA, 'idempotency-key replay must return the first result')
    assert.equal(carrierCalls, 1, 'idempotency replay must not call the carrier again')

    // exactly one row per (vbeln, exidv) in the database, label bytes stored (S2 leg)
    const { SELECT } = cds.ql
    const { Shipments } = cds.entities('courier')
    const rows = await cds.run(SELECT.from(Shipments).where({ vbeln: VBELN, exidv: 'HU00000101' }))
    assert.equal(rows.length, 1, 'exactly one shipment row per (vbeln,exidv) — DB-level guard (M1)')
  } finally {
    mock.book = realBook
  }
})
