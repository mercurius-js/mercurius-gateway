'use strict'

const { test, t } = require('tap')

const FakeTimers = require('@sinonjs/fake-timers')
const { setImmediate } = require('node:timers/promises')

const Fastify = require('fastify')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const GQL = require('mercurius')
const plugin = require('../index')

t.beforeEach(({ context }) => {
  context.clock = FakeTimers.install({
    shouldClearNativeTimers: true,
    shouldAdvanceTime: true,
    advanceTimeDelta: 40
  })
})

t.afterEach(({ context }) => {
  context.clock.uninstall()
})

test('Refreshing gateway schema', async (t) => {
  const resolvers = {
    Query: {
      me: () => user
    },
    User: {
      __resolveReference: (user) => user
    }
  }

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const userService = Fastify()
  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `),
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      cache: false
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query introspect {
          __type(name: "User") {
            fields {
              name
            }
          }
        }
      `
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      __type: {
        fields: [
          {
            name: 'id'
          },
          {
            name: 'name'
          }
        ]
      }
    }
  })

  // Update User service schema

  userService.graphql.replaceSchema(
    buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
        lastName: String!
      }
    `)
  )
  userService.graphql.defineResolvers(resolvers)

  for (let i = 0; i < 10; i++) {
    await t.context.clock.tickAsync(200)
  }

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await setImmediate()
  await setImmediate()

  await gateway.graphqlGateway.refresh()

  const updatedRes = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query introspect {
          __type(name: "User") {
            fields {
              name
            }
          }
        }
      `
    })
  })

  t.same(JSON.parse(updatedRes.body), {
    data: {
      __type: {
        fields: [
          {
            name: 'id'
          },
          {
            name: 'name'
          },
          {
            name: 'lastName'
          }
        ]
      }
    }
  })
})
