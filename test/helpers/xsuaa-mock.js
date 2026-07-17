// Shared offline-XSUAA test harness: RS256 test keys, an XSUAA-shaped token signer, and an
// in-process interception of the https JWKS fetch @sap/xssec performs — so the REAL xssec
// validation logic runs in tests with no network and no mock auth.
// (Not a *.test.js file — the node:test runner does not execute it.)
const crypto = require('node:crypto')
const https = require('node:https')
const { PassThrough } = require('node:stream')

const KID = 'test-key-1'
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const evilKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey

const CREDS = {
  clientid: 'sb-courier!t1',
  xsappname: 'courier!t1',
  url: 'https://test.authentication.localtest',
  uaadomain: 'authentication.localtest',
  identityzone: 'test-zone',
}

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function signToken(claims = {}, { key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', jku: `https://test.${CREDS.uaadomain}/token_keys`, kid }
  const payload = {
    iss: `https://test.${CREDS.uaadomain}/oauth/token`,
    exp: now + 3600,
    iat: now - 5,
    zid: CREDS.identityzone,
    cid: CREDS.clientid,
    client_id: CREDS.clientid,
    aud: [CREDS.clientid],
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    user_name: 'tester',
    scope: [`${CREDS.xsappname}.view`],
    'xs.user.attributes': { werks: ['1000'] },
    ...claims,
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), key)
  return `${signingInput}.${b64url(signature)}`
}

const jwk = publicKey.export({ format: 'jwk' })
const JWKS = { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }
const realHttpsRequest = https.request

function install() {
  https.request = function mockJwksRequest(url, options, cb) {
    if (typeof options === 'function') cb = options
    const res = new PassThrough()
    res.statusCode = 200
    res.headers = { 'content-type': 'application/json' }
    const req = new PassThrough()
    req.setTimeout = () => req
    process.nextTick(() => {
      cb(res)
      res.end(JSON.stringify(JWKS))
    })
    return req
  }
}

function uninstall() {
  https.request = realHttpsRequest
}

module.exports = { CREDS, KID, signToken, evilKey, b64url, install, uninstall }
