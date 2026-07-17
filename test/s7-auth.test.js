// S7 (docs/10 §3): expired token → 401, wrong-audience token → 401, tampered signature → 401,
// all BEFORE any handler logic. Runs fully offline: tokens are signed with a test RSA key and
// the JWKS fetch that @sap/xssec performs over https is intercepted in-process, so the REAL
// xssec validation (signature, expiry, audience, issuer) is exercised — no mock auth.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const xsuaa = require('./helpers/xsuaa-mock')

const { CREDS, signToken, evilKey, b64url } = xsuaa

let server
let base

before(async () => {
  xsuaa.install()

  const { XsuaaService } = require('@sap/xssec')
  const auth = require('../srv/middleware/auth')
  const mw = auth.middleware(new XsuaaService(CREDS))
  const viewGate = auth.requireScope('view')

  // handler runs ONLY if the middleware called next() without error — its output proves
  // where the request got to, so 401s demonstrably happen before any handler logic.
  server = http.createServer((req, res) => {
    mw(req, res, (err) => {
      if (err) {
        res.statusCode = 500
        return res.end('infrastructure-error')
      }
      if (req.url.startsWith('/webhook/')) {
        res.statusCode = 200
        return res.end('public-webhook')
      }
      viewGate(req, res, () => {
        res.statusCode = 200
        res.end(JSON.stringify({ handler: 'reached', plants: req.plants }))
      })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  xsuaa.uninstall()
  await new Promise((resolve) => server.close(resolve))
})

const get = (path, token) =>
  fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })

test('S7: no token → 401, handler never runs', async () => {
  const res = await get('/deliveries')
  assert.equal(res.status, 401)
  assert.equal(await res.text(), '') // rejected by middleware, not a handler response
})

test('S7: expired token → 401', async () => {
  const now = Math.floor(Date.now() / 1000)
  const res = await get('/deliveries', signToken({ exp: now - 60, iat: now - 3600 }))
  assert.equal(res.status, 401)
})

test('S7: tampered signature → 401', async () => {
  const [h, p] = signToken().split('.')
  const tamperedPayload = b64url(
    JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), scope: [`${CREDS.xsappname}.book`] })
  )
  const sig = signToken().split('.')[2]
  const res = await get('/deliveries', `${h}.${tamperedPayload}.${sig}`)
  assert.equal(res.status, 401)
})

test('S7: forged token (untrusted key, trusted kid) → 401', async () => {
  const res = await get('/deliveries', signToken({}, { key: evilKey }))
  assert.equal(res.status, 401)
})

test('S7: wrong-audience token → 401', async () => {
  const res = await get('/deliveries', signToken({ cid: 'sb-other!t1', client_id: 'sb-other!t1', aud: ['sb-other!t1'], scope: ['other!t1.view'] }))
  assert.equal(res.status, 401)
})

test('valid token → handler reached, plants from token attribute only', async () => {
  const res = await get('/deliveries', signToken())
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.handler, 'reached')
  assert.deepEqual(body.plants, ['1000'])
})

test('valid token without the route scope → 403 (scope gate)', async () => {
  const res = await get('/deliveries', signToken({ scope: [`${CREDS.xsappname}.config`] }))
  assert.equal(res.status, 403)
})

test('/webhook/:carrier is public — reaches its handler with no token (S5/S6 own defenses, task 1.12)', async () => {
  const res = await get('/webhook/nzpost')
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'public-webhook')
})

test('path tricks do not widen the public surface — 401 without token', async () => {
  for (const sneaky of ['/webhook/../deliveries', '/webhook/nzpost/extra', '/webhook/', '/webhookX/nzpost']) {
    const res = await get(sneaky)
    assert.equal(res.status, 401, `expected 401 for ${sneaky}`)
  }
})
