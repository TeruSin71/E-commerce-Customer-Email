// S1 guard (docs/10 H1): carrier calls go ONLY to the URL of the bound BTP destination,
// and never to private / link-local / loopback ranges (SSRF defense in depth, doc 08 §5).
// Every provider passes its target URL through assertAllowedCarrierUrl before any request.

function isPrivateHost(hostRaw) {
  const host = hostRaw.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  if (host.includes(':')) {
    // IPv6: loopback, unspecified, unique-local, link-local
    if (host === '::1' || host === '::') return true
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true
  }
  return false
}

function assertAllowedCarrierUrl(url, { destinationUrl } = {}) {
  const target = new URL(url)
  if (isPrivateHost(target.hostname)) {
    throw new Error(`carrier URL refused: private/link-local host (S1): ${target.hostname}`)
  }
  if (!destinationUrl) {
    throw new Error('carrier URL refused: no bound destination URL to validate against (S1)')
  }
  const base = new URL(destinationUrl)
  if (isPrivateHost(base.hostname)) {
    throw new Error(`destination URL refused: private/link-local host (S1): ${base.hostname}`)
  }
  if (target.origin !== base.origin) {
    throw new Error(`carrier URL refused: ${target.origin} is not the bound destination ${base.origin} (S1)`)
  }
  // ponytail: DNS-rebinding pinning (resolve + pin IP at request time) lands with the first
  // real provider's HTTP client — origin + private-range checks are the design's stated gate.
  return url
}

module.exports = { assertAllowedCarrierUrl, isPrivateHost }
