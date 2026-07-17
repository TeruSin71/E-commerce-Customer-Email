// xssec auth middleware — the chain from docs/10 §1.1: validate → (scope per route) → plants.
// Rule 1: the token is validated BEFORE any claim is read (S7). Unvalidated → 401, no logic runs.
// Rule 2: plant list comes from the token attribute ONLY — never query/body/header.
const cds = require('@sap/cds')
const { createSecurityContext, XsuaaService, errors: xssecErrors } = require('@sap/xssec')
const LOG = cds.log('auth')

function fromEnv() {
  const creds = cds.env.requires?.auth?.credentials
  return creds?.clientid ? new XsuaaService(creds) : null
}

function middleware(authService = fromEnv()) {
  if (!authService) {
    // Fail closed: without bound XSUAA credentials no request can be validated, so none passes.
    LOG.error('no XSUAA credentials bound — failing closed: all authenticated routes return 401')
    return function noAuthService(req, res, next) {
      return isPublic(req) ? next() : reject(res, 401)
    }
  }
  return async function xssecAuth(req, res, next) {
    if (isPublic(req)) return next()
    try {
      const secCtx = await createSecurityContext(authService, { req })
      req.authInfo = secCtx
      // static werks value(s) from the role collections (docs/10 §1.2); union across roles
      req.plants = toArray(secCtx.token.xsUserAttributes?.werks)
      return next()
    } catch (e) {
      if (e instanceof xssecErrors.ValidationError) return reject(res, 401)
      return next(e) // infrastructure failure (e.g. JWKS unreachable) → 500, still no data served
    }
  }
}

// per-route scope gate (docs/08 §3 route table); mounted by the route tasks 1.5+
function requireScope(scope) {
  return function scopeCheck(req, res, next) {
    return req.authInfo && req.authInfo.checkLocalScope(scope) ? next() : reject(res, 403)
  }
}

// /webhook/:carrier is the ONE public route (docs/08 §3); its own defenses are S5/S6 (task 1.12).
// Exact-shape match — dot segments or extra path parts never widen the public surface.
const PUBLIC_ROUTE = /^\/webhook\/[a-z0-9_-]+\/?$/i
function isPublic(req) {
  return PUBLIC_ROUTE.test(req.path || req.url || '')
}

function toArray(v) {
  return Array.isArray(v) ? v : v ? [v] : []
}

function reject(res, status) {
  res.statusCode = status
  return res.end()
}

module.exports = { middleware, requireScope }
