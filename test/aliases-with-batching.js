'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const plugin = require('../index')
const { users, posts } = require('./utils/mocks')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    allowBatchedQueries: true
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

async function createTestGatewayServer (t) {
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
        return users.u1
      }
    },
    User: {
      quote: (user, args) => {
        return args.input
      },
      metadata: (user, args) => {
        return {
          info: args.input
        }
      },
      __resolveReference: user => {
        return users[user.id]
      }
    }
  }
  const [userService, userServicePort] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers
  )

  // Post service
  const postServiceSchema = `
  type Post @key(fields: "pid") {
    pid: ID!
  }

  type User @key(fields: "id") @extends {
    id: ID! @external
    topPosts(count: Int!): [Post]
  }`
  const postServiceResolvers = {
    User: {
      topPosts: (user, { count }) => {
        return Object.values(posts)
          .filter(p => p.authorId === user.id)
          .slice(0, count)
      }
    }
  }
  const [postService, postServicePort] = await createTestService(
    t,
    postServiceSchema,
    postServiceResolvers
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          allowBatchedQueries: true
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          allowBatchedQueries: true
        }
      ]
    }
  })

  return gateway
}

test('gateway with batching - should support aliases', async t => {
  const app = await createTestGatewayServer(t)

  const query = `
    query {
      user: me {
        id
        name
        newName: name
        otherName: name
        quote(input: "quote")
        firstQuote: quote(input: "foo")
        secondQuote: quote(input: "bar")
        metadata(input: "info") {
          info
        }
        originalMetadata: metadata(input: "hello") {
          hi: info
          ho: info
        }
        moreMetadata: metadata(input: "hi") {
          info
        }
        somePosts: topPosts(count: 1) {
          pid
        }
        morePosts: topPosts(count: 2) {
          pid
        }
      }
    }`

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      user: {
        id: 'u1',
        name: 'John',
        newName: 'John',
        otherName: 'John',
        quote: 'quote',
        firstQuote: 'foo',
        secondQuote: 'bar',
        metadata: {
          info: 'info'
        },
        originalMetadata: {
          hi: 'hello',
          ho: 'hello'
        },
        moreMetadata: {
          info: 'hi'
        },
        somePosts: [
          {
            pid: 'p1'
          }
        ],
        morePosts: [
          {
            pid: 'p1'
          },
          {
            pid: 'p3'
          }
        ]
      }
    }
  })
})
