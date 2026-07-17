// Pure signature helpers shared by the webhook receiver and every carrier provider's
// verifyWebhook. Dependency-free on purpose — breaks the webhook↔providers require cycle.
const crypto = require('node:crypto')

const TS_WINDOW_SEC = 300 // ±5 min replay window (S5)

function timingSafeEqualHex(aHex, bHex) {
  const a = Buffer.from(String(aHex), 'hex')
  const b = Buffer.from(String(bHex), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function freshTimestamp(tsSec, nowSec = Math.floor(Date.now() / 1000)) {
  const t = Number(tsSec)
  return Number.isFinite(t) && Math.abs(nowSec - t) <= TS_WINDOW_SEC
}

module.exports = { timingSafeEqualHex, freshTimestamp, TS_WINDOW_SEC }
