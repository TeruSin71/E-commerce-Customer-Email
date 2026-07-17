// S9 smoke check (full acceptance test is a go-live criterion): the error handler must not
// let request-shaped data (names, emails, addresses) reach the logs, and must not echo
// err.message to the client.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const errors = require('../srv/middleware/errors')

test('S9: error handler logs no PII and returns a generic body', () => {
  const logged = []
  const handler = errors({ error: (...args) => logged.push(args) })

  const err = new Error('insert failed for Jane Doe <jane.doe@example.com>, 12 Main St, Auckland')
  const res = {
    statusCode: 0,
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    body: '',
    end(b) { this.body = b || '' },
  }
  handler(err, { method: 'POST', url: '/book' }, res, () => assert.fail('next() must not be called'))

  const flatLog = JSON.stringify(logged)
  assert.ok(!flatLog.includes('jane.doe@example.com'), 'email leaked into log')
  assert.ok(!flatLog.includes('Jane Doe'), 'name leaked into log')
  assert.ok(!flatLog.includes('12 Main St'), 'address leaked into log')
  assert.equal(res.statusCode, 500)
  assert.equal(res.body, JSON.stringify({ error: 'internal error' }), 'client body must be generic')
})
