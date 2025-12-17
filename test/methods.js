'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createService (t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

test('calling defineLoaders throws an error in gateway mode', async t => {
  const [service, port] = await createService(
    t,
    `
    extend type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'service-1',
          url: `http://localhost:${port}/graphql`
        }
      ]
    }
  })

  await gateway.ready()

  try {
    gateway.graphql.defineLoaders({
      Query: {
        field () {}
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Gateway issues: Calling defineLoaders method when gateway plugin is running is not allowed'
    )
  }
})

test('calling defineResolvers throws an error in gateway mode', async t => {
  const [service, port] = await createService(
    t,
    `
    extend type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'service-1',
          url: `http://localhost:${port}/graphql`
        }
      ]
    }
  })

  await gateway.ready()

  try {
    gateway.graphql.defineResolvers({
      Query: {
        field () {}
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Gateway issues: Calling defineResolvers method when gateway plugin is running is not allowed'
    )
  }
})

test('calling extendSchema throws an error in gateway mode', async t => {
  const [service, port] = await createService(
    t,
    `
    extend type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'service-1',
          url: `http://localhost:${port}/graphql`
        }
      ]
    }
  })

  await gateway.ready()

  try {
    gateway.graphql.extendSchema(`
      extend type Query {
        field: String!
      }
    `)
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Gateway issues: Calling extendSchema method when gateway plugin is running is not allowed'
    )
  }
})
