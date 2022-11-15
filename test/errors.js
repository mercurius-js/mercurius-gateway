'use strict'

const { GraphQLError } = require('graphql')
const { test } = require('tap')
const { FederatedError, defaultErrorFormatter } = require('../lib/errors')

test('errors: FederatedError ', async t => {
  t.plan(1)
  try {
    /* eslint-disable-next-line no-new */
    new FederatedError(new Error('test'))
  } catch (error) {
    t.same(error.message, 'errors must be an Array')
  }
})

test('errors: defaultErrorFormatter with single errors', t => {
  const app = {
    log: {
      info: (obj, message) => {
        t.same(message, 'test error')
      }
    }
  }

  const errors = [new GraphQLError('test error')]
  const res = defaultErrorFormatter({ errors }, { app })

  t.same(res.statusCode, 200)
  t.same(res.response, {
    data: null,
    errors: [
      {
        message: 'test error'
      }
    ]
  })

  t.end()
})

test('errors: defaultErrorFormatter with multiple errors', t => {
  const app = {
    log: {
      info: (obj, message) => {
        t.same(message, 'test error')
      }
    }
  }

  const errors = [new GraphQLError('test error'), new GraphQLError('test error')]
  const res = defaultErrorFormatter({ errors }, { app })

  t.same(res.statusCode, 200)
  t.same(res.response, {
    data: null,
    errors: [
      {
        message: 'test error'
      },
      {
        message: 'test error'
      }
    ]
  })

  t.end()
})
