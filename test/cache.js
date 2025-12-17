'use strict'

const { test } = require('node:test')
const { buildCache } = require('../lib/util')

test('buildCache: default ', async t => {
  const cache = buildCache({})
  t.assert.deepStrictEqual(cache.max, 1024)
})

test('buildCache: with a boolean ', async t => {
  const cache = buildCache({ cache: true })
  t.assert.deepStrictEqual(cache.max, 1024)
})

test('buildCache: disabled with a boolean ', async t => {
  const cache = buildCache({ cache: false })
  t.assert.ok(!cache)
})

test('buildCache: with an integer', async t => {
  const cache = buildCache({ cache: 10 })
  t.assert.deepStrictEqual(cache.max, 10)
})
test('buildCache: with an integer', async t => {
  try {
    buildCache({ cache: 'wrong value' })
  } catch (error) {
    t.assert.strictEqual(error.message, 'Invalid options: Cache type is not supported')
  }
})
