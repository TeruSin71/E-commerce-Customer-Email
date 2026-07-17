// H3 fail-closed contract (docs/09 §3): there is NO query path without the allowed-plants list.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const forPlants = require('../srv/lib/repository')

test('repository refuses to construct without a plants list', () => {
  for (const bad of [undefined, null, [], {}, '1000', [''], [1000], ['1000', null]]) {
    assert.throws(() => forPlants(bad), /allowed-plants/, `accepted: ${JSON.stringify(bad)}`)
  }
})
