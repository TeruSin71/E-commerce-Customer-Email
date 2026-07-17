// PII-scrubbing error handler (S9, docs/09 §4): logs never carry name/address/email/label
// content. err.message may embed request data, so it is dropped entirely — we keep the error
// class, code, and code locations (stack frames from line 1 on, which hold file:line only).
const cds = require('@sap/cds')
const LOG = cds.log('courier-srv')

module.exports = function errors(log = LOG) {
  return function scrubbedErrors(err, req, res, next) {
    const frames = (err.stack || '').split('\n').slice(1, 4).map((s) => s.trim())
    log.error('unhandled error', {
      name: err.name,
      code: err.code,
      status: err.status || 500,
      method: req.method,
      path: req.path || req.url, // ids like vbeln are loggable; names/emails never appear in paths
      frames,
    })
    if (res.headersSent) return next(err)
    res.statusCode = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'internal error' })) // no err.message passthrough — may echo input
  }
}
