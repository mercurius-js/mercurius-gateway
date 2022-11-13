'use strict'

const { test } = require('tap')
const { FederatedError } = require('../lib/errors')

test('errors: FederatedError ', async t => {
  t.plan(1)
  try {
    /* eslint-disable-next-line no-new */
    new FederatedError(new Error('test'))
  } catch (error) {
    t.same(error.message, 'errors must be an Array')
  }
})
