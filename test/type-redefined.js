'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

const users = {
  1: {
    id: 1,
    name: 'John',
    username: '@john'
  },
  2: {
    id: 2,
    name: 'Jane',
    username: '@jane'
  }
}

async function buildService () {
  const app = Fastify()
  const schema = `
    extend type Query {
      me: User
    }

    type PageInfo {
      edges: [User]
    }

    type User @key(fields: "id") {
      id: ID!
      name: String
      username: String
    }
  `

  const resolvers = {
    Query: {
      me: () => {
        return users['1']
      }
    }
  }

  const loaders = {
    User: {
      async __resolveReference (queries) {
        return queries.map(({ obj }) => users[obj.id])
      }
    }
  }

  app.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    loaders,
    allowBatchedQueries: true
  })

  return app
}

async function buildServiceExternal () {
  const app = Fastify()
  const schema = `
    extend type Query {
      meWrap: PageInfo
      meWrapDifferentName: PageInfoRenamed
    }

    type PageInfoRenamed {
      edges: [User]
    }
    
    type PageInfo {
      edges: [User]
    }
    
    type User @key(fields: "id") @extends {
      id: ID! @external
    }
  `

  const resolvers = {
    Query: {
      meWrap: () => {
        return { edges: [{ id: '1', __typename: 'User' }] }
      },
      meWrapDifferentName: () => {
        return { edges: [{ id: '1', __typename: 'User' }] }
      }
    }
  }

  app.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    allowBatchedQueries: true
  })

  return app
}

async function buildProxy (port1, port2) {
  const gateway = Fastify()

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'ext1',
          url: `http://localhost:${port1}/graphql`
        },
        {
          name: 'ext2',
          url: `http://localhost:${port2}/graphql`
        }
      ]
    },
    pollingInterval: 2000
  })

  return gateway
}

test('federated node should be able to redefine type', async t => {
  const serviceOne = await buildService()
  await serviceOne.listen({ port: 0 })
  const port1 = serviceOne.server.address().port
  t.after(() => {
    serviceOne.close()
  })

  const serviceTwo = await buildServiceExternal()
  await serviceTwo.listen({ port: 0 })
  const port2 = serviceTwo.server.address().port
  t.after(() => {
    serviceTwo.close()
  })

  const serviceProxy = await buildProxy(port1, port2)
  await serviceProxy.ready()
  t.after(() => {
    serviceProxy.close()
  })

  {
    const res = await serviceProxy.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `{
        meWrap { edges { name }  }
      }`
      }
    })

    t.assert.deepStrictEqual(res.json(), { data: { meWrap: { edges: [{ name: 'John' }] } } })
  }

  {
    const res = await serviceProxy.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `{
        meWrapDifferentName { edges { name }  }
      }`
      }
    })

    t.assert.deepStrictEqual(res.json(), {
      data: { meWrapDifferentName: { edges: [{ name: 'John' }] } }
    })
  }
})
