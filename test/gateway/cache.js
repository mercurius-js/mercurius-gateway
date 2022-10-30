'use strict'

const { test } = require('tap')
const { buildCache } = require('../../lib/util')

test('buildCache: default ', async t => {
  t.plan(1)
  const cache = buildCache({})
  t.same(cache.max, 1024)
})

test('buildCache: with a boolean ', async t => {
  t.plan(1)
  const cache = buildCache({ cache: true })
  t.same(cache.max, 1024)
})

test('buildCache: disabled with a boolean ', async t => {
  t.plan(1)
  const cache = buildCache({ cache: false })
  t.notOk(cache)
})

test('buildCache: with an integer', async t => {
  t.plan(1)
  const cache = buildCache({ cache: 10 })
  t.same(cache.max, 10)
})
test('buildCache: with an integer', async t => {
  t.plan(1)
  try {
    buildCache({ cache: 'wrong value' })
  } catch (error) {
    t.same(error.message, 'Invalid options: Cache type is not supported')
  }
})
