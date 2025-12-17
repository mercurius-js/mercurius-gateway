'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const { ErrorWithProps } = require('../lib/errors')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (
  schema,
  resolvers = {},
  allowBatchedQueries = false
) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    allowBatchedQueries
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

async function createTestGatewayServer (t, allowBatchedQueries = false) {
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
        throw new ErrorWithProps('Invalid User ID', {
          id: 4,
          code: 'USER_ID_INVALID'
        })
      }
    },
    User: {
      quote: () => {
        throw new ErrorWithProps('Invalid Quote', {
          id: 4,
          code: 'QUOTE_ID_INVALID'
        })
      }
    }
  }
  const [userService, userServicePort] = await createTestService(
    userServiceSchema,
    userServiceResolvers,
    allowBatchedQueries
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
      topPosts: () => {
        throw new ErrorWithProps('Invalid Quote', {
          id: 4,
          code: 'NO_TOP_POSTS'
        })
      }
    }
  }
  const [postService, postServicePort] = await createTestService(
    postServiceSchema,
    postServiceResolvers,
    allowBatchedQueries
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          allowBatchedQueries
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          allowBatchedQueries
        }
      ]
    }
  })

  return gateway
}

test('it returns the same error if batching is enabled', async t => {
  const app1 = await createTestGatewayServer(t)
  const app2 = await createTestGatewayServer(t, true)

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

  const res1 = await app1.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  await app1.close()

  const res2 = await app2.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res1.body), JSON.parse(res2.body))
})
