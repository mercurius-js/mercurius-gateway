'use strict'

const { GraphQLError } = require('graphql')
const { test } = require('tap')
const { FederatedError, defaultErrorFormatter } = require('../lib/errors')
const GQL = require('mercurius')
const Fastify = require('fastify')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (
  t,
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
    t,
    userServiceSchema,
    userServiceResolvers
  )

  const gateway = Fastify()
  t.teardown(async () => {
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

test('errors - custom error formatter that uses default error formatter', async t => {
  const app = await createTestGatewayServer(t, (err, ctx) => {
    t.ok(ctx)
    t.equal(ctx.app, app)
    t.ok(ctx.reply)
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
  t.equal(res.statusCode, 500)
  t.equal(body.errors[0].message, 'Invalid User ID')
})
