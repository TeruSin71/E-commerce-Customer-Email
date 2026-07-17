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
let labelId1000 // seeded werks-1000 shipment (label/reprint target)

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
  labelId1000 = '00000000-0000-0000-0000-000000000001'
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
test('S1: destination-only carrier URLs; private/link-local ranges refused', { todo: 'red until task 1.6 (provider + destination resolver)' }, () => {
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
test('S2: /label/:id — 401 without token, 403 wrong plant, bytes for right plant', { todo: 'red until tasks 1.8/1.9 (book + label routes)' }, async () => {
  const noToken = await call(`/label/${labelId1000}`)
  assert.equal(noToken.status, 401, 'unauthenticated label download must be 401')

  const wrongPlant = await call(`/label/${labelId1000}`, { token: tokenFor(['2000'], ['view', 'reprint']) })
  assert.equal(wrongPlant.status, 403, 'wrong-plant label download must be 403')

  const rightPlant = await call(`/label/${labelId1000}`, { token: tokenFor(['1000'], ['view', 'reprint']) })
  assert.equal(rightPlant.status, 200, 'right-plant label download must serve stored bytes')
  const body = await rightPlant.text()
  assert.ok(!/https?:\/\//.test(body), 'label response must be stored bytes, never a carrier URL (H2)')
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
test('S4: concurrent /book for same (vbeln,exidv) yields one booking; idempotency key replays first result', { todo: 'red until task 1.8 (/book)' }, async () => {
  const token = tokenFor(['1000'], ['view', 'rate', 'book'])
  const bookReq = (idempotencyKey) =>
    call('/book', { method: 'POST', token, body: { vbeln: '0080000001', rateId: 'rate-1', idempotencyKey } })

  const [a, b] = await Promise.all([bookReq('key-1'), bookReq('key-2')])
  assert.ok(a.status < 300 && b.status < 300, `both bookings must succeed (got ${a.status}/${b.status})`)
  const [bodyA, bodyB] = [await a.json(), await b.json()]
  assert.deepEqual(
    bodyA.map((r) => r.tracking).sort(),
    bodyB.map((r) => r.tracking).sort(),
    'second booking must receive the FIRST booking, not a new one'
  )

  // replay with the same idempotency key → identical response, no new booking
  const replay = await bookReq('key-1')
  assert.ok(replay.status < 300)
  assert.deepEqual(await replay.json(), bodyA, 'idempotency-key replay must return the first result')

  // exactly one row per (vbeln, exidv) in the database
  const { SELECT } = cds.ql
  const { Shipments } = cds.entities('courier')
  const rows = await cds.run(SELECT.from(Shipments).where({ vbeln: '0080000001', exidv: 'HU0001' }))
  assert.equal(rows.length, 1, 'exactly one shipment row per (vbeln,exidv) — DB-level guard (M1)')
})
