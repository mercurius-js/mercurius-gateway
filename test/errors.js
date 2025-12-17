'use strict'

const { GraphQLError } = require('graphql')
const { test } = require('node:test')
const { FederatedError, defaultErrorFormatter } = require('../lib/errors')
const GQL = require('mercurius')
const Fastify = require('fastify')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (
  schema,
  resolvers = {}
) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

async function createTestGatewayServer (t, errorFormatter = undefined) {
  // User service
  const userServiceSchema = `
  type Query @extends {
    me: User
  }

  type Metadata {
    info: String!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    quote(input: String!): String!
    metadata(input: String!): Metadata!
  }`
  const userServiceResolvers = {
    Query: {
      me: () => {
        throw new Error('Invalid User ID', {
          id: 4,
          code: 'USER_ID_INVALID'
        })
      }
    },
    User: {
      quote: () => {
        throw new Error('Invalid Quote', {
          id: 4,
          code: 'QUOTE_ID_INVALID'
        })
      }
    }
  }
  const [userService, userServicePort] = await createTestService(
    userServiceSchema,
    userServiceResolvers
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userService.close()
  })

  gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    },
    ...(errorFormatter ? { errorFormatter } : {})
  })

  return gateway
}

test('errors: FederatedError ', async t => {
  try {
    /* eslint-disable-next-line no-new */
    new FederatedError(new Error('test'))
  } catch (error) {
    t.assert.deepStrictEqual(error.message, 'errors must be an Array')
  }
})

test('errors: defaultErrorFormatter with single errors', t => {
  const app = {
    log: {
      info: (obj, message) => {
        t.assert.deepStrictEqual(message, 'test error')
      }
    }
  }

  const errors = [new GraphQLError('test error')]
  const res = defaultErrorFormatter({ errors }, { app })

  t.assert.deepStrictEqual(res.statusCode, 200)
  t.assert.deepStrictEqual(res.response, {
    data: null,
    errors: [
      {
        message: 'test error'
      }
    ]
  })
})

test('errors: defaultErrorFormatter with multiple errors', t => {
  const app = {
    log: {
      info: (obj, message) => {
        t.assert.deepStrictEqual(message, 'test error')
      }
    }
  }

  const errors = [new GraphQLError('test error'), new GraphQLError('test error')]
  const res = defaultErrorFormatter({ errors }, { app })

  t.assert.deepStrictEqual(res.statusCode, 200)
  t.assert.deepStrictEqual(res.response, {
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
})

test('errors - custom error formatter that uses default error formatter', async t => {
  const app = await createTestGatewayServer(t, (err, ctx) => {
    t.assert.ok(ctx)
    t.assert.strictEqual(ctx.app, app)
    t.assert.ok(ctx.reply)
    const response = defaultErrorFormatter(err, ctx)
    response.statusCode = 500
    return response
  })
  const query = `
    query {
      user: me {
        id
      }
    }`

  await app.ready()

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  await app.close()

  const body = JSON.parse(res.body)
  t.assert.strictEqual(res.statusCode, 500)
  t.assert.strictEqual(body.errors[0].message, 'Invalid User ID')
})
