'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const { promisify } = require('util')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const immediate = promisify(setImmediate)
const { users, customers, posts } = require('./utils/mocks')

async function createTestService (t, schema, resolvers, serviceName) {
  const service = Fastify()

  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })

  service.addHook('onSend', async (request, reply, payload) => {
    reply.header(serviceName, 'true')
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
  t.teardown(async () => {
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
            collectHeaders: true
          }
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          collectors: {
            collectHeaders: true
          }
        },
        {
          name: 'customer',
          url: `http://localhost:${customerServicePort}/graphql`,
          collectors: {
            collectHeaders: false
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
  t.plan(2)
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('onResolution', async function (_, context) {
    await immediate()
    t.has(context.collectors.responseHeaders, {
      topPosts: {
        service: 'post',
        data: {
          post: 'true'
        }
      },
      me: {
        service: 'user',
        data: {
          user: 'true'
        }
      }
    })
    t.notHas(context.collectors.responseHeaders, {
      lastCustomer: {
        service: 'customer',
        data: {
          customer: 'true'
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
