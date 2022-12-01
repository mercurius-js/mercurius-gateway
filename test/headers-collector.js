'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const { promisify } = require('util')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const immediate = promisify(setImmediate)

async function createTestService (t, schema, resolvers = {}, serviceName) {
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

const users = {
  u1: {
    id: 'u1',
    name: 'John'
  },
  u2: {
    id: 'u2',
    name: 'Jane'
  }
}

const customers = {
  c1: {
    id: 'u1',
    name: 'John'
  },
  c2: {
    id: 'u2',
    name: 'Jane'
  }
}

const posts = {
  p1: {
    pid: 'p1',
    title: 'Post 1',
    content: 'Content 1',
    authorId: 'u1'
  },
  p2: {
    pid: 'p2',
    title: 'Post 2',
    content: 'Content 2',
    authorId: 'u2'
  },
  p3: {
    pid: 'p3',
    title: 'Post 3',
    content: 'Content 3',
    authorId: 'u1'
  },
  p4: {
    pid: 'p4',
    title: 'Post 4',
    content: 'Content 4',
    authorId: 'u1'
  }
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
      customer {
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
      customer: Customer
    }
  
    type Customer @key(fields: "id") {
      id: ID!
      name: String!
    }`

  const customerServiceResolvers = {
    Query: {
      customer: () => {
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
        post: 'true'
      },
      me: {
        user: 'true'
      }
    })
    t.notHas(context.collectors.responseHeaders, {
      customer: {
        customer: 'true'
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
