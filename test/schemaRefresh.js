'use strict'

const { test } = require('tap')

const Fastify = require('fastify')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const GQL = require('mercurius')
const plugin = require('../index')

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

  t.same(res.json(), {
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

  t.same(updatedRes.json(), {
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
