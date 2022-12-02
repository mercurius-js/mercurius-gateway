'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
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
  t.teardown(async () => {
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

test('gateway: resolverKey should support digits', async t => {
  t.plan(7)
  const app = await createTestGatewayServer(t)

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({
      query: `
        query {
          user1: me {
            id
            somePostsOne: topPosts(count: 1) {
              pid
            }
            somePostsTwo: topPosts(count: 2) {
              pid
            }
            somePosts1: topPosts(count: 1) {
              pid
            }
            somePosts2: topPosts(count: 2) {
              pid
            }
            some3Posts: topPosts(count: 3) {
              pid
            }
          }
          user2: me {
            id
            somePostsOne: topPosts(count: 2) {
              pid
            }
            somePostsTwo: topPosts(count: 1) {
              pid
            }
            somePosts1: topPosts(count: 2) {
              pid
            }
            somePosts2: topPosts(count: 1) {
              pid
            }
            some3Posts: topPosts(count: 4) {
              pid
            }
          }
        }`
    })
  })

  const resParsed = JSON.parse(res.body).data

  // Verify user1 res
  t.same(resParsed.user1.somePostsOne, resParsed.user1.somePosts1)
  t.same(resParsed.user1.somePostsTwo, resParsed.user1.somePosts2)
  t.notSame(resParsed.user1.somePosts2, resParsed.user1.some3Posts)
  // Verify user2 res
  t.same(resParsed.user2.somePostsOne, resParsed.user2.somePosts1)
  t.same(resParsed.user2.somePostsTwo, resParsed.user2.somePosts2)
  t.notSame(resParsed.user2.somePosts2, resParsed.user2.some3Posts)
  // Verify user1 vs user2 res
  t.notSame(resParsed.user1, resParsed.user2)
})
