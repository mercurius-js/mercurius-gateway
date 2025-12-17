'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const { createClient } = require('graphql-ws')
const ws = require('ws')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (port, schema, resolvers = {}) {
  const service = Fastify()

  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    ide: true,
    routes: true,
    subscription: true
  })
  await service.listen({ port })
  return service
}

const schemaBody = `
  type User {
    name: String
  }
  extend type Query {
    result(num: Int): Int
  }

  extend type Mutation {
    updateUser(name: String): User
  }
  `
const resolvers = {
  Query: {
    result: async (_, { num }) => {
      return num
    }
  },
  Mutation: {
    updateUser: (_, { name }) => {
      return {
        name
      }
    }
  }
}

test('gateway - send query using graphql-ws protocol', async t => {
  const service1 = await createTestService(0, schemaBody, resolvers)
  const gateway = Fastify()

  t.after(async () => {
    await gateway.close()
    await service1.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'test',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          wsUrl: `ws://localhost:${service1.server.address().port}/graphql`,
          wsConnectionParams: {
            protocols: ['graphql-ws']
          },
          keepAlive: 3000
        }
      ]
    },
    routes: true,
    subscription: {
      fullWsTransport: true
    },
    jit: 1
  })

  await gateway.listen({ port: 0 })

  const client = createClient({
    url: `ws://localhost:${gateway.server.address().port}/graphql`,
    webSocketImpl: ws
  })

  await new Promise((resolve, reject) => {
    client.subscribe(
      {
        query: '{ result(num: 5) }'
      },
      {
        next: data => {
          t.assert.deepStrictEqual(data, { data: { result: 5 } })
        },
        complete: () => {
          client.dispose()
          resolve()
        },
        error: reject
      }
    )
  })
})

test('gateway - send mutations using graphql-ws protocol', async t => {
  const service1 = await createTestService(0, schemaBody, resolvers)

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await service1.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'test',
          url: `http://localhost:${service1.server.address().port}/graphql`,
          wsUrl: `ws://localhost:${service1.server.address().port}/graphql`,
          wsConnectionParams: {
            protocols: ['graphql-ws']
          },
          keepAlive: 3000
        }
      ]
    },
    routes: true,
    subscription: {
      fullWsTransport: true
    },
    jit: 1
  })

  await gateway.listen({ port: 0 })

  const client = createClient({
    url: `ws://localhost:${gateway.server.address().port}/graphql`,
    webSocketImpl: ws
  })

  await new Promise((resolve, reject) => {
    client.subscribe(
      {
        query: `
        mutation {
          updateUser(name: "Random user") {
            name
          }
        }
      `
      },
      {
        next: data => {
          t.assert.deepStrictEqual(data, { data: { updateUser: { name: 'Random user' } } })
        },
        complete: () => {
          client.dispose()
          resolve()
        },
        error: reject
      }
    )
  })
})
