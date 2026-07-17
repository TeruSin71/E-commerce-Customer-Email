// Provider registry (doc 08 §5): providerId → CourierProvider implementation.
// Real providers (nzpost, fedex, …) register here as they land. The MOCK provider is
// registered ONLY outside production — a booking against MOCK in production is impossible.
const providers = {}

// providers/nzpost.js registers here when task 1.6b lands (gated: Open Item #2 + 0.4)

if (process.env.NODE_ENV !== 'production') {
  providers.MOCK = require('./mock')
}

function providerFor(providerId) {
  const p = providers[providerId]
  if (!p) {
    // fail closed: unknown/unregistered carrier is an error, never a fallback
    throw Object.assign(new Error(`no provider registered for carrier ${providerId}`), { status: 422 })
  }
  return p
}

module.exports = { providerFor }
