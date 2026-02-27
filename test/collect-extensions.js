'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const { promisify } = require('util')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users, customers, posts } = require('./utils/mocks')

const immediate = promisify(setImmediate)

async function createTestService (t, schema, resolvers, serviceName) {
  const service = Fastify()

  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })

  await service.ready()

  service.graphql.addHook('onResolution', async (execution) => {
    execution.extensions = {
      [serviceName]: serviceName
    }
  })

  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

const query = `
    query {
      me {
        id
        name
        topPosts(count: 2) {
          pid
          author {
            id
          }
        }
      }
      topPosts(count: 2) {
        pid
      }
      lastCustomer {
        id
        name
      }
    }
  `

async function createTestGatewayServer (t, opts = {}) {
  // User service
  const userServiceSchema = `
    type Query @extends {
      me: User
    }
  
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }`
  const userServiceResolvers = {
    Query: {
      me: () => {
        return users.u1
      }
    },
    User: {
      __resolveReference: (user) => {
        return users[user.id]
      }
    }
  }
  const [userService, userServicePort] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers,
    'user'
  )

  // Post service
  const postServiceSchema = `
    type Post @key(fields: "pid") {
      pid: ID!
      author: User
    }
  
    extend type Query {
      topPosts(count: Int): [Post]
    }
  
    type User @key(fields: "id") @extends {
      id: ID! @external
      topPosts(count: Int!): [Post]
    }`
  const postServiceResolvers = {
    Post: {
      __resolveReference: (post) => {
        return posts[post.pid]
      },
      author: (post) => {
        return {
          __typename: 'User',
          id: post.authorId
        }
      }
    },
    User: {
      topPosts: (user, { count }) => {
        return Object.values(posts)
          .filter((p) => p.authorId === user.id)
          .slice(0, count)
      }
    },
    Query: {
      topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
    }
  }
  const [postService, postServicePort] = await createTestService(
    t,
    postServiceSchema,
    postServiceResolvers,
    'post'
  )

  // Customer service
  const customerServiceSchema = `
    type Query @extends {
      lastCustomer: Customer
    }
  
    type Customer @key(fields: "id") {
      id: ID!
      name: String!
    }`

  const customerServiceResolvers = {
    Query: {
      lastCustomer: () => {
        return customers.c1
      }
    },
    Customer: {
      __resolveReference: (customer) => {
        return customers[customer.id]
      }
    }
  }

  const [customerService, customerServicePort] = await createTestService(
    t,
    customerServiceSchema,
    customerServiceResolvers,
    'customer'
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
    await customerService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          collectors: {
            collectExtensions: true
          }
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          collectors: {
            collectExtensions: true
          }
        },
        {
          name: 'customer',
          url: `http://localhost:${customerServicePort}/graphql`,
          collectors: {
            collectExtensions: false
          }
        }
      ]
    },
    ...opts
  })

  return gateway
}

// -----
// hooks
// -----
test('gateway - hooks', async (t) => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('onResolution', async function (_, context) {
    await immediate()
    t.assert.partialDeepStrictEqual(context.collectors.extensions, {
      topPosts: {
        service: 'post',
        data: {
          post: 'post'
        }
      },
      me: {
        service: 'user',
        data: {
          user: 'user'
        }

      }
    })
    t.assert.notDeepEqual(context.collectors.extensions, {
      lastCustomer: {
        service: 'customer',
        data: {
          customer: 'customer'
        }
      }
    })
  })

  await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })
})
